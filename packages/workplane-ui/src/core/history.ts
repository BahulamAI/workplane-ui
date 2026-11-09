import type { CommittedEvent, JsonValue, Operation } from "../protocol/index.js";
import { getPointer } from "../protocol/index.js";
import type { Block, Scene, WorkplaneDocument } from "./document.js";
import { applyOperations } from "./reducer.js";

/**
 * Reconstructing a past revision.
 *
 * Events record what changed, not what it changed FROM, so history cannot be
 * walked backwards — `state.set` does not carry the previous value and
 * `block.remove` does not carry the removed block. Reconstruction is therefore
 * always forward, from a known-good snapshot.
 *
 * That snapshot is a checkpoint. PRD section 19.1 allows compaction with
 * checkpoints for exactly this reason: without one, pruning old events would
 * make every revision before the prune unreachable.
 */
export interface Checkpoint {
  revision: number;
  document: WorkplaneDocument;
}

export type ReconstructResult =
  | { ok: true; document: WorkplaneDocument }
  | {
      ok: false;
      reason: "no-checkpoint" | "missing-events" | "replay-failed";
      message: string;
      /** Earliest revision that IS reachable, when one is known. */
      earliestReachable?: number;
    };

/**
 * Rebuild the document as it stood at `revision`.
 *
 * Deliberately returns a typed failure rather than a best-effort document. A
 * historical view that is quietly wrong is worse than one that refuses: someone
 * will compare it against live data and trust the difference.
 */
export function documentAt(
  revision: number,
  checkpoints: readonly Checkpoint[],
  events: readonly CommittedEvent[],
): ReconstructResult {
  if (revision < 0) {
    return { ok: false, reason: "no-checkpoint", message: "Revision must be zero or greater" };
  }

  // Nearest checkpoint at or before the target.
  const base = [...checkpoints]
    .filter((c) => c.revision <= revision)
    .sort((a, b) => b.revision - a.revision)[0];

  if (!base) {
    const earliest = [...checkpoints].sort((a, b) => a.revision - b.revision)[0];
    return {
      ok: false,
      reason: "no-checkpoint",
      message:
        `Revision ${revision} is before the earliest checkpoint, so it cannot be rebuilt. ` +
        "History was compacted past this point.",
      ...(earliest ? { earliestReachable: earliest.revision } : {}),
    };
  }

  if (base.revision === revision) return { ok: true, document: base.document };

  // Every event between the checkpoint and the target must be present and
  // contiguous. A gap means the replay would silently skip a change.
  const needed = events
    .filter((e) => e.revision > base.revision && e.revision <= revision)
    .sort((a, b) => a.revision - b.revision);

  const expected = revision - base.revision;
  if (needed.length !== expected) {
    return {
      ok: false,
      reason: "missing-events",
      message:
        `Rebuilding revision ${revision} needs ${expected} event(s) after checkpoint ` +
        `${base.revision} but ${needed.length} are available.`,
      earliestReachable: base.revision,
    };
  }
  for (const [index, event] of needed.entries()) {
    if (event.revision !== base.revision + index + 1) {
      return {
        ok: false,
        reason: "missing-events",
        message: `History has a gap at revision ${base.revision + index + 1}.`,
        earliestReachable: base.revision,
      };
    }
  }

  try {
    let document = base.document;
    for (const event of needed) {
      document = { ...applyOperations(document, event.operations), revision: event.revision };
    }
    return { ok: true, document };
  } catch (error) {
    return {
      ok: false,
      reason: "replay-failed",
      message: `Replay failed at or before revision ${revision}: ${(error as Error).message}`,
      earliestReachable: base.revision,
    };
  }
}

/** Should a checkpoint be written at this revision? */
export function shouldCheckpoint(revision: number, every = 25): boolean {
  return revision === 1 || revision % every === 0;
}

// --- diff -------------------------------------------------------------------

export interface SharedChange {
  path: string;
  from: JsonValue | undefined;
  to: JsonValue | undefined;
}

export interface DocumentDiff {
  fromRevision: number;
  toRevision: number;
  scenes: {
    added: string[];
    removed: string[];
    retitled: Array<{ id: string; from: string; to: string }>;
    reordered: boolean;
  };
  blocks: {
    added: string[];
    removed: string[];
    /** Spec, title, bindings or dataRefs changed. */
    changed: string[];
    /** Moved to a different scene. */
    moved: Array<{ id: string; from: string | undefined; to: string | undefined }>;
  };
  shared: SharedChange[];
  empty: boolean;
}

function sceneOf(document: WorkplaneDocument, blockId: string): string | undefined {
  for (const sceneId of document.sceneOrder) {
    if (document.scenes[sceneId]?.blockOrder.includes(blockId)) return sceneId;
  }
  return undefined;
}

function blockChanged(a: Block, b: Block): boolean {
  return (
    a.title !== b.title ||
    a.rendererId !== b.rendererId ||
    a.specVersion !== b.specVersion ||
    JSON.stringify(a.spec) !== JSON.stringify(b.spec) ||
    JSON.stringify(a.bindings) !== JSON.stringify(b.bindings) ||
    JSON.stringify(a.dataRefs) !== JSON.stringify(b.dataRefs)
  );
}

/** Flatten an object into JSON Pointer → value pairs, leaves only. */
function flatten(value: JsonValue, prefix = "", out = new Map<string, JsonValue>()): Map<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    out.set(prefix || "/", value);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child as JsonValue, `${prefix}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, out);
  }
  return out;
}

/**
 * Structural difference between two documents.
 *
 * Reports what a reader needs to decide whether to restore, at the granularity
 * the operation set works in — scenes, blocks, and shared paths — rather than a
 * text diff of JSON nobody can act on.
 */
export function diffDocuments(from: WorkplaneDocument, to: WorkplaneDocument): DocumentDiff {
  const fromScenes = new Set(from.sceneOrder);
  const toScenes = new Set(to.sceneOrder);
  const fromBlocks = new Set(Object.keys(from.blocks));
  const toBlocks = new Set(Object.keys(to.blocks));

  const retitled: DocumentDiff["scenes"]["retitled"] = [];
  for (const id of from.sceneOrder) {
    const a = from.scenes[id];
    const b = to.scenes[id];
    if (a && b && a.title !== b.title) retitled.push({ id, from: a.title, to: b.title });
  }

  const changed: string[] = [];
  const moved: DocumentDiff["blocks"]["moved"] = [];
  for (const id of fromBlocks) {
    const a = from.blocks[id];
    const b = to.blocks[id];
    if (!a || !b) continue;
    if (blockChanged(a, b)) changed.push(id);
    const sceneA = sceneOf(from, id);
    const sceneB = sceneOf(to, id);
    if (sceneA !== sceneB) moved.push({ id, from: sceneA, to: sceneB });
  }

  const flatFrom = flatten(from.shared);
  const flatTo = flatten(to.shared);
  const shared: SharedChange[] = [];
  for (const path of new Set([...flatFrom.keys(), ...flatTo.keys()])) {
    const a = flatFrom.get(path);
    const b = flatTo.get(path);
    if (JSON.stringify(a) !== JSON.stringify(b)) shared.push({ path, from: a, to: b });
  }

  const sharedOrder = from.sceneOrder.filter((id) => toScenes.has(id));
  const targetOrder = to.sceneOrder.filter((id) => fromScenes.has(id));
  const reordered = sharedOrder.join(",") !== targetOrder.join(",");

  const diff: DocumentDiff = {
    fromRevision: from.revision,
    toRevision: to.revision,
    scenes: {
      added: to.sceneOrder.filter((id) => !fromScenes.has(id)),
      removed: from.sceneOrder.filter((id) => !toScenes.has(id)),
      retitled,
      reordered,
    },
    blocks: {
      added: [...toBlocks].filter((id) => !fromBlocks.has(id)),
      removed: [...fromBlocks].filter((id) => !toBlocks.has(id)),
      changed,
      moved,
    },
    shared,
    empty: false,
  };
  diff.empty =
    diff.scenes.added.length === 0 &&
    diff.scenes.removed.length === 0 &&
    retitled.length === 0 &&
    !reordered &&
    diff.blocks.added.length === 0 &&
    diff.blocks.removed.length === 0 &&
    changed.length === 0 &&
    moved.length === 0 &&
    shared.length === 0;
  return diff;
}

// --- restore ----------------------------------------------------------------

export interface RestorePlan {
  /** Scene and block changes. Safe to commit as one transaction. */
  structural: Operation[];
  /**
   * Shared-state changes, separated because they are subject to the writable
   * path policy: a value that was writable when it was set may not be now, and
   * a restore must not fail wholesale because of one such path.
   */
  shared: Operation[];
  warnings: string[];
}

/**
 * Operations that make `current` look like `target`.
 *
 * A restore is a NEW commit that moves the document forward, never a rewrite of
 * history — PRD section 9.5. It also cannot undo anything outside the document:
 * a job that ran, a file that was exported, a resource that was deleted. The
 * caller is responsible for saying so before offering the control.
 *
 * Ordering is chosen so no intermediate step is rejected by the reducer:
 * scenes are created before anything moves into them, blocks leave a scene
 * before that scene is removed, and ordering is fixed last.
 */
export function restoreOperations(
  current: WorkplaneDocument,
  target: WorkplaneDocument,
): RestorePlan {
  const structural: Operation[] = [];
  const shared: Operation[] = [];
  const warnings: string[] = [];

  const currentScenes = new Set(current.sceneOrder);
  const targetScenes = new Set(target.sceneOrder);
  const currentBlocks = new Set(Object.keys(current.blocks));
  const targetBlocks = new Set(Object.keys(target.blocks));

  // 1. Create scenes the target has, so later moves have somewhere to land.
  for (const sceneId of target.sceneOrder) {
    if (currentScenes.has(sceneId)) continue;
    const scene = target.scenes[sceneId] as Scene;
    structural.push({
      op: "scene.add",
      scene: { id: scene.id, title: scene.title, layout: scene.layout, parameters: scene.parameters },
    });
  }

  // 2. Remove blocks the target does not have.
  for (const blockId of currentBlocks) {
    if (!targetBlocks.has(blockId)) structural.push({ op: "block.remove", blockId });
  }

  // 3. Move surviving blocks out of scenes that are about to disappear, and
  //    into whichever scene the target says owns them.
  for (const blockId of targetBlocks) {
    if (!currentBlocks.has(blockId)) continue;
    const from = sceneOf(current, blockId);
    const to = sceneOf(target, blockId);
    if (to && from !== to) structural.push({ op: "block.move", blockId, sceneId: to });
  }

  // 4. Remove scenes the target does not have. Cascade is safe now: anything
  //    the target still wants has already moved out.
  for (const sceneId of current.sceneOrder) {
    if (!targetScenes.has(sceneId)) {
      structural.push({ op: "scene.remove", sceneId, blocks: "cascade" });
    }
  }

  // 5. Add blocks the target has and the current document lacks.
  for (const sceneId of target.sceneOrder) {
    for (const blockId of target.scenes[sceneId]?.blockOrder ?? []) {
      if (currentBlocks.has(blockId)) continue;
      const block = target.blocks[blockId] as Block;
      structural.push({
        op: "block.add",
        sceneId,
        block: {
          id: block.id, kind: block.kind, title: block.title,
          rendererId: block.rendererId, specVersion: block.specVersion, spec: block.spec,
          bindings: block.bindings, dataRefs: block.dataRefs, fallback: block.fallback,
        },
      });
    }
  }

  // 6a. Restore scene properties. The diff reports a retitle; without this the
  //     scene comes back under whatever name it was given since.
  for (const sceneId of target.sceneOrder) {
    const a = current.scenes[sceneId];
    const b = target.scenes[sceneId] as Scene;
    if (!a) continue; // freshly added above, already correct
    const patch: { title?: string; layout?: Scene["layout"]; parameters?: Scene["parameters"] } = {};
    if (a.title !== b.title) patch.title = b.title;
    if (a.layout !== b.layout) patch.layout = b.layout;
    if (JSON.stringify(a.parameters) !== JSON.stringify(b.parameters)) patch.parameters = b.parameters;
    if (Object.keys(patch).length > 0) structural.push({ op: "scene.update", sceneId, patch });
  }

  // 6b. Update blocks whose contents differ.
  for (const blockId of targetBlocks) {
    const a = current.blocks[blockId];
    const b = target.blocks[blockId] as Block;
    if (!a || !blockChanged(a, b)) continue;
    structural.push({
      op: "block.update",
      blockId,
      patch: { title: b.title, spec: b.spec, bindings: b.bindings, dataRefs: b.dataRefs, fallback: b.fallback },
    });
    if (a.rendererId !== b.rendererId || a.specVersion !== b.specVersion) {
      // block.update deliberately cannot change which renderer draws a block;
      // that would silently reinterpret its spec.
      warnings.push(
        `Block "${blockId}" used renderer ${b.rendererId}@${b.specVersion} at the target revision ` +
          `but ${a.rendererId}@${a.specVersion} now. Its renderer is not restored.`,
      );
    }
  }

  // 7. Restore order, last, when every member exists.
  for (const sceneId of target.sceneOrder) {
    const order = target.scenes[sceneId]?.blockOrder ?? [];
    let previous: string | null = null;
    for (const blockId of order) {
      structural.push({ op: "block.move", blockId, sceneId, afterBlockId: previous });
      previous = blockId;
    }
  }
  let previousScene: string | null = null;
  for (const sceneId of target.sceneOrder) {
    structural.push({ op: "scene.move", sceneId, afterSceneId: previousScene });
    previousScene = sceneId;
  }

  // 8. Shared state, separately.
  for (const change of diffDocuments(current, target).shared) {
    if (change.to === undefined) {
      warnings.push(
        `Shared value "${change.path}" existed at the current revision but not at the target. ` +
          "The operation set cannot delete a shared path, so it is left as it is.",
      );
      continue;
    }
    shared.push({ op: "state.set", path: change.path, value: change.to });
  }
  if (shared.length > 0) {
    warnings.push(
      `${shared.length} shared value(s) are restored separately and may be refused if a path ` +
        "is no longer writable by policy.",
    );
  }

  return { structural, shared, warnings };
}

/** Everything a caller must show before offering a restore control. */
export function describeRestore(plan: RestorePlan, diff: DocumentDiff): string[] {
  const lines: string[] = [];
  if (diff.empty) return ["This revision is identical to the current document."];
  const { scenes, blocks } = diff;
  if (scenes.added.length) lines.push(`${scenes.added.length} scene(s) will be restored`);
  if (scenes.removed.length) lines.push(`${scenes.removed.length} scene(s) will be removed`);
  if (blocks.added.length) lines.push(`${blocks.added.length} block(s) will be restored`);
  if (blocks.removed.length) lines.push(`${blocks.removed.length} block(s) will be removed`);
  if (blocks.changed.length) lines.push(`${blocks.changed.length} block(s) will be reverted`);
  if (plan.shared.length) lines.push(`${plan.shared.length} shared value(s) will be reset`);
  lines.push(
    "This creates a NEW revision. It does not rewrite history, and it cannot undo " +
      "anything that happened outside the document — a render job, an export, or a deleted resource.",
  );
  return lines;
}
