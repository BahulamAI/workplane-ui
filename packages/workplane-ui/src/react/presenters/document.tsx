import { useCallback } from "react";
import { useWorkplaneContext } from "../context.js";
import { useControllerState, useSceneOrder, useViewState } from "../hooks.js";
import { BlockPrimitive, ScenePrimitive, WorkplanePrimitive } from "../primitives.js";
import type { PresenterDefinition, RendererEvent } from "../registry.js";

/**
 * Continuous vertical sections with a sticky scene navigator.
 *
 * The fallback presenter: dense editing, accessibility, print, and narrow
 * resource budgets. Feed and Stack are presentations of the SAME scenes
 * against this same contract — none of them is a different document format.
 */
function SceneNavigator(): React.ReactNode {
  const sceneOrder = useSceneOrder();
  const { document } = useControllerState();
  const { controller } = useWorkplaneContext();
  const view = useViewState();

  if (sceneOrder.length < 2) return null;

  /**
   * Scroll explicitly rather than relying on the browser to honour the
   * fragment.
   *
   * A plugin panel runs inside a sandboxed iframe, where `#fragment`
   * navigation does not reliably move the view — the link looked correct, its
   * target existed, and clicking it did nothing. The `href` is kept so the
   * control is a real link: focusable, keyboard-activatable, and meaningful to
   * open-in-new-tab and to assistive technology.
   */
  const go = useCallback(
    (event: React.MouseEvent, sceneId: string) => {
      // Let a modified click do what the user asked of the browser.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      controller.session.patchViewState({ activeSceneId: sceneId });

      const target = globalThis.document?.getElementById(`scene-${sceneId}`);
      if (!target) return;
      target.scrollIntoView({
        behavior: view.reducedMotion ? "auto" : "smooth",
        block: "start",
      });
      // An explicit navigation command moves focus to the scene heading, so a
      // keyboard or screen-reader user lands where a sighted user is looking.
      const heading = globalThis.document?.getElementById(`scene-heading-${sceneId}`);
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    },
    [controller, view.reducedMotion],
  );

  return (
    /* Ordinary links, not a tablist: these do not switch panels, they jump
       within one scrolling document. Mislabelling them as tabs would make the
       keyboard contract a lie. */
    <nav data-workplane="scene-nav" aria-label="Scenes">
      <ol>
        {sceneOrder.map((sceneId, index) => (
          <li key={sceneId}>
            <a
              href={`#scene-${sceneId}`}
              aria-current={view.activeSceneId === sceneId ? "true" : undefined}
              onClick={(event) => go(event, sceneId)}
            >
              <span data-workplane="scene-nav-index">{index + 1}</span>
              {document?.scenes[sceneId]?.title ?? sceneId}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function DocumentPresenter(): React.ReactNode {
  const { controller } = useWorkplaneContext();

  /**
   * Normalized renderer events become commands, reads, or local state — never
   * a direct write. A selection is a committed document change; a draft is not.
   */
  const onEvent = useCallback(
    (event: RendererEvent, blockId: string) => {
      switch (event.type) {
        case "selection.changed": {
          controller.session.setSelection(blockId, event.payload.ids);
          const block = controller.document?.blocks[blockId];
          const spec = block?.spec as { selectionPath?: string } | undefined;
          if (spec?.selectionPath) {
            void controller.setSharedValue(spec.selectionPath, [...event.payload.ids]);
          }
          break;
        }
        case "value.commit":
          void controller.setSharedValue(event.payload.path, event.payload.value);
          break;
        case "action.request": {
          // The renderer emits an intent; the controller decides. A block
          // cannot reach the broker, so what a button may do stays a host
          // decision rather than a document one.
          void controller.requestAction(event.payload).then((outcome) => {
            if ("status" in outcome && outcome.status === "unsupported") {
              console.warn(`[workplane] action "${event.payload.actionId}": ${outcome.reason}`);
            }
          });
          break;
        }
        case "value.draft":
          // Drafts stay local until an explicit commit.
          break;
      }
    },
    [controller],
  );

  return (
    <WorkplanePrimitive.Root data-mode="document">
      <header data-workplane="header">
        <WorkplanePrimitive.Title />
        <WorkplanePrimitive.IfStale>
          <span data-workplane="stale-badge" role="status">
            Updating…
          </span>
        </WorkplanePrimitive.IfStale>
      </header>

      <SceneNavigator />

      <WorkplanePrimitive.IfEmpty>
        <p data-workplane="empty">This workspace has no scenes yet.</p>
      </WorkplanePrimitive.IfEmpty>

      <main data-workplane="scenes">
        <WorkplanePrimitive.Scenes>
          <ScenePrimitive.Root>
            <ScenePrimitive.Heading />
            <div data-workplane="scene-blocks">
              <ScenePrimitive.Blocks>
                <BlockPrimitive.Root>
                  <BlockPrimitive.Title />
                  <BlockPrimitive.Content onEvent={onEvent} />
                </BlockPrimitive.Root>
              </ScenePrimitive.Blocks>
            </div>
          </ScenePrimitive.Root>
        </WorkplanePrimitive.Scenes>
      </main>
    </WorkplanePrimitive.Root>
  );
}

export const documentPresenter: PresenterDefinition = {
  mode: "document",
  Component: DocumentPresenter,
};
