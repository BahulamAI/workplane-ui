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
              onClick={() => controller.session.patchViewState({ activeSceneId: sceneId })}
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
        case "value.draft":
        case "action.request":
          // Drafts stay local; actions require a host ActionBroker, which is
          // an explicit unsupported state rather than a silent no-op.
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
