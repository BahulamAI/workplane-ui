import { useCallback, useEffect, useRef } from "react";
import { ActivityProvider, SceneProvider, useWorkplaneContext } from "../context.js";
import { HistoryBanner } from "../history.js";
import { useControllerState, useSceneNavigation, useViewState } from "../hooks.js";
import { BlockPrimitive, ScenePrimitive, WorkplanePrimitive } from "../primitives.js";
import type { PresenterDefinition } from "../registry.js";
import { claimsGestures, useRendererEvents } from "./events.js";

/**
 * Time Machine: the active scene in front, a bounded number of receding preview
 * cards behind it, and a rail — PRD section 5.4.4.
 *
 * Depth is CSS perspective on DOM wrappers. No 3D engine is involved in the
 * navigation itself; a scene's own 3D content, if it has any, stays inside its
 * block adapter where it belongs.
 *
 * Two things separate this from Feed, and both are deliberate.
 *
 * A background card is an INERT PREVIEW, not a suspended renderer. Feed keeps a
 * neighbouring scene mounted so stepping to it is instant; Stack must not, because
 * mounting a live chart, movie, or iframe per depth layer is what this section
 * says to avoid. So the cards render block previews, and inertness comes from the
 * platform `inert` attribute rather than from styling — a card that merely looks
 * uninteractive is still tabbable and still announced, so a keyboard reader would
 * traverse three copies of a document they cannot act on.
 *
 * And Stack READS THE WHEEL, where Feed deliberately never does. Feed advances
 * through native scroll-snap; this is a transform effect with no scroll
 * container, so it has no such luxury. The constraints from 5.4.4 are therefore
 * met explicitly: the wheel is read only over the rail or the scene background,
 * a gesture already claimed by a child is ignored, and an accumulation threshold
 * plus end-of-gesture settling stops one inertial flick from skipping many scenes.
 */

/** Default preview depth, per section 5.4.4. */
const DEFAULT_DEPTH = 3;
/** Each extra card is another mounted preview for diminishing visual return. */
const MAX_DEPTH = 5;

/** Wheel distance that counts as one deliberate step. */
const WHEEL_THRESHOLD = 120;
/** Quiet period that ends a gesture, so inertia does not keep stepping. */
const SETTLE_MS = 180;

function SceneRail(): React.ReactNode {
  const nav = useSceneNavigation();
  const { document } = useControllerState();
  const activeTitle = document?.scenes[nav.activeSceneId ?? ""]?.title ?? "";

  return (
    <nav data-workplane="stack-rail" aria-label="Scenes">
      {/* Position, stated plainly — "3 of 12" is required by 5.4.4. */}
      <p data-workplane="stack-position" role="status">
        {nav.sceneOrder.length === 0
          ? "No scenes"
          : `${nav.activeIndex + 1} of ${nav.sceneOrder.length}${activeTitle ? ` — ${activeTitle}` : ""}`}
      </p>
      <ol>
        {nav.sceneOrder.map((sceneId, index) => (
          <li key={sceneId}>
            {/* Links, like the other presenters: this moves within one document
                rather than switching panels. */}
            <a
              href={`#scene-${sceneId}`}
              aria-current={nav.activeSceneId === sceneId ? "true" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                nav.goTo(sceneId);
              }}
            >
              <span data-workplane="stack-rail-index">{index + 1}</span>
              {document?.scenes[sceneId]?.title ?? sceneId}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function StackPresenter({ depth }: { depth: number }): React.ReactNode {
  const { controller } = useWorkplaneContext();
  const { document } = useControllerState();
  const view = useViewState();
  const nav = useSceneNavigation();
  const onEvent = useRendererEvents();

  const stackRef = useRef<HTMLDivElement>(null);
  /** Accumulated wheel distance for the gesture in progress. */
  const wheelRef = useRef(0);
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settleRef.current), []);

  /**
   * The wheel, with the three constraints section 5.4.4 places on it.
   *
   * Attached natively with `passive: false` rather than through React's
   * `onWheel`. React registers wheel, touchstart and touchmove as PASSIVE
   * listeners on the root, so `preventDefault` from a React handler is ignored —
   * the browser logs a warning and scrolls the page anyway, which here would mean
   * the page moving at the same time as the stack.
   *
   * The stack element is the whole region, but a gesture already claimed by a
   * child is ignored, so a table, a chart, or a 3D view inside the active scene
   * keeps its own wheel.
   */
  const navRef = useRef(nav);
  navRef.current = nav;

  useEffect(() => {
    const element = stackRef.current;
    if (!element) return;

    function onWheel(event: WheelEvent): void {
      if (claimsGestures(event.target as Element)) return;

      wheelRef.current += event.deltaY;
      clearTimeout(settleRef.current);
      // End-of-gesture settling: a trackpad emits a long inertial tail, and
      // without this one flick walks the whole stack.
      settleRef.current = setTimeout(() => { wheelRef.current = 0; }, SETTLE_MS);

      if (Math.abs(wheelRef.current) < WHEEL_THRESHOLD) return;
      const forward = wheelRef.current > 0;
      wheelRef.current = 0;
      // Claim the gesture only once it is actually navigation, so a small
      // movement that never reaches the threshold still behaves like a scroll.
      event.preventDefault();
      if (forward) navRef.current.next();
      else navRef.current.previous();
    }

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (claimsGestures(globalThis.document?.activeElement ?? null)) return;
      // Depth reads as up/down and as back/forward, so both pairs work.
      if (["ArrowDown", "ArrowRight", "PageDown"].includes(event.key)) {
        event.preventDefault();
        nav.next();
      } else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        nav.previous();
      } else if (event.key === "Escape") {
        event.preventDefault();
        controller.session.patchViewState({ mode: "document" });
      }
    },
    [nav, controller],
  );

  /** The active scene, plus up to `depth` cards behind it. */
  const visible = nav.sceneOrder
    .map((sceneId, index) => ({ sceneId, index, offset: index - nav.activeIndex }))
    .filter(({ offset }) => offset >= 0 && offset <= depth);

  return (
    <WorkplanePrimitive.Root data-mode="stack">
      <header data-workplane="header">
        <WorkplanePrimitive.Title />
        <WorkplanePrimitive.IfStale>
          <span data-workplane="stale-badge" role="status">Updating…</span>
        </WorkplanePrimitive.IfStale>
      </header>

      <HistoryBanner />
      <SceneRail />

      <WorkplanePrimitive.IfEmpty>
        <p data-workplane="empty">This workspace has no scenes yet.</p>
      </WorkplanePrimitive.IfEmpty>

      <div
        data-workplane="stack"
        data-reduced-motion={view.reducedMotion ? "true" : undefined}
        role="region"
        aria-label="Scene stack"
        tabIndex={-1}
        ref={stackRef}
        onKeyDown={onKeyDown}
      >
        {visible.map(({ sceneId, offset }) => {
          const scene = document?.scenes[sceneId];
          if (!scene) return null;
          const isActive = offset === 0;

          return (
            <div
              key={sceneId}
              data-workplane="stack-layer"
              data-scene-id={sceneId}
              data-depth={offset}
              data-active={isActive || undefined}
              // The depth projection itself. A custom property rather than an
              // inline transform, so a host restyles the effect through CSS
              // without forking this file.
              style={{ ["--wp-stack-depth" as string]: String(offset) }}
              // Removes the subtree from pointer events, focus order, AND the
              // accessibility tree in one move. Section 5.4.4: only the active
              // scene receives interaction.
              {...(isActive ? {} : { inert: true })}
              aria-hidden={isActive ? undefined : "true"}
              onClick={isActive ? undefined : () => nav.goTo(sceneId)}
            >
              <ActivityProvider value={isActive ? "active" : "near"}>
                <SceneProvider value={scene}>
                  <ScenePrimitive.Root>
                    <ScenePrimitive.Heading />
                    <div data-workplane="scene-blocks">
                      <ScenePrimitive.Blocks>
                        {isActive ? (
                          <BlockPrimitive.Root>
                            <BlockPrimitive.Title />
                            <BlockPrimitive.Content onEvent={onEvent} />
                          </BlockPrimitive.Root>
                        ) : (
                          /* A card, not a renderer. This is the difference from
                             Feed's neighbouring scenes. */
                          <BlockPrimitive.Preview />
                        )}
                      </ScenePrimitive.Blocks>
                    </div>
                  </ScenePrimitive.Root>
                </SceneProvider>
              </ActivityProvider>
            </div>
          );
        })}

        {/* A card behind the deepest visible one is implied but not mounted, so
            the reader can tell the stack continues. */}
        {nav.activeIndex + depth < nav.sceneOrder.length - 1 ? (
          <div data-workplane="stack-more" aria-hidden="true" />
        ) : null}
      </div>

      <nav data-workplane="stack-controls" aria-label="Scene navigation">
        {/* Always available, per 5.4.4 — the wheel is an addition, never the
            only way through. */}
        <button type="button" onClick={nav.previous} disabled={!nav.hasPrevious}>
          Previous
        </button>
        <button type="button" onClick={nav.next} disabled={!nav.hasNext}>
          Next
        </button>
        <button
          type="button"
          data-workplane="stack-exit"
          onClick={() => controller.session.patchViewState({ mode: "document" })}
        >
          Exit to document view
        </button>
      </nav>
    </WorkplanePrimitive.Root>
  );
}

/**
 * Build the Stack presenter.
 *
 * Depth is chosen by the host at registration rather than per render, and
 * clamped: section 5.4.4 allows host configuration "within a safe limit", and
 * each additional card is another mounted preview.
 */
export function createStackPresenter(options?: { depth?: number }): PresenterDefinition {
  const depth = Math.min(MAX_DEPTH, Math.max(1, Math.trunc(options?.depth ?? DEFAULT_DEPTH)));
  return {
    mode: "stack",
    Component: () => <StackPresenter depth={depth} />,
  };
}

export const stackPresenter: PresenterDefinition = createStackPresenter();
