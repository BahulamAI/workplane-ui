import { useCallback, useEffect, useRef } from "react";
import type { BlockActivity } from "../../renderers/index.js";
import { ActivityProvider, SceneProvider, useWorkplaneContext } from "../context.js";
import { useControllerState, useSceneNavigation, useViewState } from "../hooks.js";
import { BlockPrimitive, ScenePrimitive, WorkplanePrimitive } from "../primitives.js";
import type { PresenterDefinition } from "../registry.js";
import { focusOwnsArrowKeys, useRendererEvents } from "./events.js";

/**
 * One scene at a time, advanced by sliding — horizontally by default, or
 * vertically for a Reels-style feed. The same scenes, blocks and revisions as
 * Document: switching presentation is not a migration.
 *
 * Two decisions carry most of the weight here.
 *
 * FIRST: navigation is native CSS scroll-snap observed by IntersectionObserver,
 * and there is no wheel or touch handler anywhere in this file. Intercepting
 * the gesture is how a presenter ends up fighting the things inside it — a
 * table that will not scroll, a chart that will not zoom, a 3D scene that will
 * not orbit. By never claiming the gesture we cannot lose it, and a child that
 * wants the wheel simply takes it.
 *
 * SECOND: only a window of scenes is mounted. Scenes outside it hold their
 * place with a placeholder of the same size, so a deep link to scene 40 of 100
 * does not mount the preceding 39 — and a renderer holding a WebGL context or a
 * decoder is told to let it go, because browsers cap live contexts at around
 * eight and sliding through scenes would exhaust them within a few swipes.
 */

/** Scenes kept mounted either side of the active one, so a step is instant. */
const WINDOW = 1;

function activityFor(distance: number): BlockActivity {
  if (distance === 0) return "active";
  return distance <= WINDOW ? "near" : "offscreen";
}

function SceneRail(): React.ReactNode {
  const nav = useSceneNavigation();
  const { document } = useControllerState();

  if (nav.sceneOrder.length < 2) return null;

  return (
    /* Links, not a tablist: these move within one document rather than
       switching panels, and mislabelling them would make the keyboard
       contract a lie. Same choice as the Document presenter's navigator. */
    <nav data-workplane="feed-rail" aria-label="Scenes">
      <ol>
        {nav.sceneOrder.map((sceneId, index) => (
          <li key={sceneId}>
            <a
              href={`#scene-${sceneId}`}
              aria-current={nav.activeSceneId === sceneId ? "true" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                nav.goTo(sceneId);
              }}
            >
              <span data-workplane="feed-rail-index">{index + 1}</span>
              {document?.scenes[sceneId]?.title ?? sceneId}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Holds an unmounted scene's place.
 *
 * It must occupy exactly the space the real scene would, or removing a scene
 * from the window shifts everything after it and the reader is thrown to a
 * different position than the one they scrolled to. It also names the scene, so
 * the rail and the placeholder agree about what is there.
 */
function ScenePlaceholder({ title }: { title: string }): React.ReactNode {
  return (
    <div data-workplane="feed-placeholder" aria-hidden="true">
      <p>{title}</p>
    </div>
  );
}

function FeedPresenter(): React.ReactNode {
  const { controller } = useWorkplaneContext();
  const { document } = useControllerState();
  const view = useViewState();
  const nav = useSceneNavigation();
  const onEvent = useRendererEvents();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  const axis = view.feedAxis;
  const sceneKey = nav.sceneOrder.join("|");

  /**
   * Observe which scene is on screen rather than counting gestures.
   *
   * Re-subscribing whenever the active scene changed would tear the observer
   * down mid-scroll, so the active scene is read from the session at callback
   * time instead of being a dependency.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | undefined;
        for (const entry of entries) {
          if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
        }
        // Past the halfway point, or it is not the scene being looked at.
        if (!best || best.intersectionRatio < 0.5) return;
        const sceneId = (best.target as HTMLElement).dataset.sceneId;
        if (!sceneId) return;
        if (controller.session.getViewState().activeSceneId === sceneId) return;
        controller.session.patchViewState({ activeSceneId: sceneId });
      },
      { root: scroller, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    for (const element of scroller.querySelectorAll<HTMLElement>('[data-workplane="feed-scene"]')) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [controller, sceneKey]);

  /** Bring the active scene into view when something else chose it. */
  useEffect(() => {
    const sceneId = nav.activeSceneId;
    if (!sceneId) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target = [...scroller.querySelectorAll<HTMLElement>('[data-workplane="feed-scene"]')]
      .find((element) => element.dataset.sceneId === sceneId);
    if (!target) return;
    // A deep link lands without animation: a smooth scroll across 39 scenes is
    // a long meaningless journey, and it would fire the observer the whole way.
    const instant = !restoredRef.current || view.reducedMotion;
    restoredRef.current = true;
    // Not every environment implements it — jsdom does not, and neither do
    // some embedded webviews. Scrolling is an enhancement here; the active
    // scene is already correct without it.
    target.scrollIntoView?.({ behavior: instant ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  }, [nav.activeSceneId, view.reducedMotion]);

  /**
   * Arrow keys, but only when nothing inside has claimed them, and never as a
   * global shortcut — this listener lives on the scroller, so it sees only keys
   * pressed within the feed.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (focusOwnsArrowKeys(globalThis.document?.activeElement ?? null)) return;

      const forward = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
      const back = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
      if (event.key === forward || event.key === "PageDown") {
        event.preventDefault();
        nav.next();
      } else if (event.key === back || event.key === "PageUp") {
        event.preventDefault();
        nav.previous();
      } else if (event.key === "Escape") {
        // The stated escape to ordinary scrolling, which is also the
        // accessibility and print fallback.
        event.preventDefault();
        controller.session.patchViewState({ mode: "document" });
      }
    },
    [axis, nav, controller],
  );

  const activeTitle = document?.scenes[nav.activeSceneId ?? ""]?.title ?? "";

  return (
    <WorkplanePrimitive.Root data-mode="feed" data-axis={axis}>
      <header data-workplane="header">
        <WorkplanePrimitive.Title />
        <WorkplanePrimitive.IfStale>
          <span data-workplane="stale-badge" role="status">
            Updating…
          </span>
        </WorkplanePrimitive.IfStale>
      </header>

      <SceneRail />

      <WorkplanePrimitive.IfEmpty>
        <p data-workplane="empty">This workspace has no scenes yet.</p>
      </WorkplanePrimitive.IfEmpty>

      <div
        ref={scrollerRef}
        data-workplane="feed-scroller"
        data-axis={axis}
        data-reduced-motion={view.reducedMotion ? "true" : undefined}
        // Focusable so the keyboard contract works before anything inside is
        // focused, and labelled so a screen reader announces what it landed in.
        tabIndex={-1}
        role="region"
        aria-label="Scenes"
        onKeyDown={onKeyDown}
      >
        {nav.sceneOrder.map((sceneId, index) => {
          const scene = document?.scenes[sceneId];
          if (!scene) return null;
          const activity = activityFor(Math.abs(index - nav.activeIndex));

          return (
            <div
              key={sceneId}
              data-workplane="feed-scene"
              data-scene-id={sceneId}
              data-activity={activity}
            >
              {activity === "offscreen" ? (
                <ScenePlaceholder title={scene.title} />
              ) : (
                <ActivityProvider value={activity}>
                  <SceneProvider value={scene}>
                    <ScenePrimitive.Root>
                      <ScenePrimitive.Heading />
                      {/* Its own scroll container: a tall table inside a scene
                          scrolls itself and must not advance the feed. */}
                      <div data-workplane="scene-blocks">
                        <ScenePrimitive.Blocks>
                          <BlockPrimitive.Root>
                            <BlockPrimitive.Title />
                            <BlockPrimitive.Content onEvent={onEvent} />
                          </BlockPrimitive.Root>
                        </ScenePrimitive.Blocks>
                      </div>
                    </ScenePrimitive.Root>
                  </SceneProvider>
                </ActivityProvider>
              )}
            </div>
          );
        })}
      </div>

      <nav data-workplane="feed-controls" aria-label="Scene navigation">
        <button type="button" onClick={nav.previous} disabled={!nav.hasPrevious}>
          Previous
        </button>
        <span data-workplane="feed-position" role="status">
          {nav.sceneOrder.length === 0
            ? ""
            : `${nav.activeIndex + 1} of ${nav.sceneOrder.length}${activeTitle ? ` — ${activeTitle}` : ""}`}
        </span>
        <button type="button" onClick={nav.next} disabled={!nav.hasNext}>
          Next
        </button>
        <button
          type="button"
          data-workplane="feed-exit"
          onClick={() => controller.session.patchViewState({ mode: "document" })}
        >
          Exit to document view
        </button>
      </nav>
    </WorkplanePrimitive.Root>
  );
}

export const feedPresenter: PresenterDefinition = {
  mode: "feed",
  Component: FeedPresenter,
};
