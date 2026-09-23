import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Block, ControllerState, Scene, WorkplaneDocument } from "@bahulam/workplane-core";
import type { QueryResult } from "@bahulam/workplane-data";
import { getPointer, type JsonValue } from "@bahulam/workplane-protocol";
import { useBlockContext, useWorkplaneContext } from "./context.js";

/** Subscribes to the controller's external store. No state lives in React. */
export function useControllerState(): ControllerState {
  const { controller } = useWorkplaneContext();
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

export function useDocument(): WorkplaneDocument | undefined {
  return useControllerState().document;
}

export function useScene(sceneId: string): Scene | undefined {
  return useDocument()?.scenes[sceneId];
}

export function useBlock(blockId: string): Block | undefined {
  return useDocument()?.blocks[blockId];
}

export function useSceneOrder(): readonly string[] {
  return useDocument()?.sceneOrder ?? [];
}

export function useQueryResult(queryId: string | undefined): QueryResult | undefined {
  const { epoch } = useControllerState();
  return queryId ? epoch.results.get(queryId) : undefined;
}

/** True while a newer evaluation epoch is still loading. */
export function useIsStale(): boolean {
  return useControllerState().epoch.stale;
}

/** Read a committed value. Reading is free; writing goes through commit. */
export function useSharedValue(path: string): JsonValue | undefined {
  const { document } = useControllerState();
  const { controller } = useWorkplaneContext();
  void document; // resubscribe on every committed change
  return controller.resolveBinding(path);
}

function useSessionSnapshot<T>(select: () => T): T {
  const { controller } = useWorkplaneContext();
  const subscribe = useCallback(
    (listener: () => void) => controller.session.subscribe(listener),
    [controller],
  );
  return useSyncExternalStore(subscribe, select, select);
}

export interface DraftHandle {
  /** The draft value if one exists, otherwise the committed value. */
  value: JsonValue | undefined;
  isDirty: boolean;
  /** Record a keystroke locally. Commits nothing. */
  change: (value: JsonValue) => void;
  /** Validate against the committed value and commit, or report a conflict. */
  commit: () => Promise<{ status: "committed" | "unchanged" | "conflict" | "rejected"; message?: string; theirValue?: JsonValue }>;
  discard: () => void;
}

/**
 * A controlled draft over one writable path.
 *
 * Typing never touches shared state and never wakes an agent. On commit the
 * baseline is compared against what is committed NOW, so a concurrent change
 * surfaces as a conflict instead of one side silently winning.
 */
export function useDraft(path: string): DraftHandle {
  const { controller } = useWorkplaneContext();
  const state = useControllerState();
  const committed = controller.resolveBinding(path);
  const draft = useSessionSnapshot(() => controller.session.getDraft(path));

  const change = useCallback(
    (value: JsonValue) => {
      controller.session.setDraft(path, value, {
        value: committed as JsonValue,
        revision: state.document?.revision ?? 0,
      });
    },
    [controller, path, committed, state.document?.revision],
  );

  const commit = useCallback(async () => {
    const current = controller.resolveBinding(path) as JsonValue;
    const resolution = controller.session.resolveDraft(path, current);
    if (!resolution) return { status: "unchanged" as const };
    if (resolution.status === "unchanged") {
      controller.session.clearDraft(path);
      return { status: "unchanged" as const };
    }
    if (resolution.status === "conflict") {
      return {
        status: "conflict" as const,
        theirValue: resolution.theirValue,
        message: "This value changed while you were editing it.",
      };
    }
    const result = await controller.setSharedValue(path, resolution.draft.value);
    if (!result.ok) {
      return { status: "rejected" as const, message: result.error.message };
    }
    controller.session.clearDraft(path);
    return { status: "committed" as const };
  }, [controller, path]);

  const discard = useCallback(() => controller.session.clearDraft(path), [controller, path]);

  return useMemo(
    () => ({
      value: draft ? draft.value : committed,
      isDirty: draft !== undefined,
      change,
      commit,
      discard,
    }),
    [draft, committed, change, commit, discard],
  );
}

/** Resolved bindings and results for the block in context. */
export function useBlockData(): {
  results: ReadonlyMap<string, QueryResult>;
  bindings: Record<string, JsonValue | undefined>;
  stale: boolean;
} {
  const block = useBlockContext();
  const { document, epoch } = useControllerState();

  return useMemo(() => {
    // A block receives ONLY the results it declared. It cannot reach another
    // block's data by asking for it.
    const results = new Map<string, QueryResult>();
    for (const queryId of block.dataRefs) {
      const result = epoch.results.get(queryId);
      if (result) results.set(queryId, result);
    }
    // Bindings resolve from `shared`, so this memo must invalidate when the
    // DOCUMENT changes -- a committed `state.set` alters neither the block nor
    // the query epoch, and keying on those alone leaves bound blocks stale.
    const bindings: Record<string, JsonValue | undefined> = {};
    for (const [name, binding] of Object.entries(block.bindings)) {
      bindings[name] =
        binding.scope === "shared" && document
          ? getPointer(document.shared, binding.path)
          : undefined;
    }
    return { results, bindings, stale: epoch.stale };
  }, [block, document, epoch]);
}

export function useSelection(blockId: string): readonly string[] {
  const { controller } = useWorkplaneContext();
  return useSessionSnapshot(() => controller.session.getSelection(blockId));
}

export function useViewState() {
  const { controller } = useWorkplaneContext();
  return useSessionSnapshot(() => controller.session.getViewState());
}
