import { useCallback } from "react";
import { useWorkplaneContext } from "../context.js";
import type { RendererEvent } from "../registry.js";

/**
 * Turns a normalized renderer event into a command, a read, or local state —
 * never a direct write.
 *
 * Shared by every presenter so the meaning of a click cannot drift between
 * presentations: the same selection in Document and in Feed must produce the
 * same revision, or the two views of one document disagree.
 */
export function useRendererEvents(): (event: RendererEvent, blockId: string) => void {
  const { controller } = useWorkplaneContext();

  return useCallback(
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
}

/**
 * Whether this element, or anything it sits inside, has already claimed its own
 * gestures — arrow keys, the wheel, or a drag.
 *
 * A presenter that binds Previous/Next must not steal from a text field, a
 * slider, a scrollable table, or an embedded application that orbits a 3D
 * scene. Asking the element is the only reliable test: a presenter cannot
 * enumerate every interactive renderer a host might install.
 *
 * Called with the FOCUSED element for a key press and with the EVENT TARGET for
 * a wheel or pointer gesture, because those are the two ways a child can be the
 * one that should decide.
 */
export function claimsGestures(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  // `role="application"` is the platform's own way of saying "I handle keys".
  // The table's scroll container and a chart canvas say the same thing with
  // their own markers.
  return Boolean(
    element.closest?.(
      '[role="application"],[data-workplane="table-scroll"],[data-workplane-claims-keys="true"]',
    ),
  );
}
