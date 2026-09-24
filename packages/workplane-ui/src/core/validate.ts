import { canonicalize, type JsonValue } from "../protocol/index.js";
import type { WorkplaneDocument } from "./document.js";
import { SCHEMA_VERSION } from "./document.js";
import { DEFAULT_LIMITS, type WorkplaneLimits } from "./limits.js";

export interface Violation {
  /** JSON Pointer into the document. */
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; violations: Violation[] };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

function depthOf(value: JsonValue, seen = 0): number {
  if (value === null || typeof value !== "object") return seen;
  let deepest = seen + 1;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const d = depthOf(child as JsonValue, seen + 1);
    if (d > deepest) deepest = d;
  }
  return deepest;
}

function byteLength(value: JsonValue): number {
  return new TextEncoder().encode(canonicalize(value)).length;
}

/**
 * Structural invariants of a document, checked after a transaction is applied
 * to a copy and before anything is persisted.
 *
 * Schema-valid is not semantically valid: this enforces referential integrity,
 * id uniqueness, single-scene membership, and size limits that a JSON Schema
 * pass would let through.
 */
export function validateDocument(
  document: WorkplaneDocument,
  limits: WorkplaneLimits = DEFAULT_LIMITS,
): ValidationResult<WorkplaneDocument> {
  const violations: Violation[] = [];
  const fail = (path: string, message: string) => violations.push({ path, message });

  if (document.schemaVersion !== SCHEMA_VERSION) {
    fail("/schemaVersion", `Unsupported schema version "${document.schemaVersion}"`);
  }
  if (!ID_PATTERN.test(document.id) || document.id.length > limits.maxIdLength) {
    fail("/id", "Document id is empty, too long, or contains unsupported characters");
  }
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    fail("/revision", "Revision must be a non-negative integer");
  }
  if (document.title.length > limits.maxTitleLength) {
    fail("/title", `Title exceeds ${limits.maxTitleLength} characters`);
  }

  // --- scene order: no duplicates, no dangling ids, no unlisted scenes ------
  const sceneIds = Object.keys(document.scenes);
  if (sceneIds.length > limits.maxScenes) {
    fail("/scenes", `Document has ${sceneIds.length} scenes, limit is ${limits.maxScenes}`);
  }
  const seenSceneOrder = new Set<string>();
  document.sceneOrder.forEach((sceneId, index) => {
    if (seenSceneOrder.has(sceneId)) {
      fail(`/sceneOrder/${index}`, `Scene "${sceneId}" appears more than once in sceneOrder`);
    }
    seenSceneOrder.add(sceneId);
    if (!document.scenes[sceneId]) {
      fail(`/sceneOrder/${index}`, `sceneOrder references unknown scene "${sceneId}"`);
    }
  });
  for (const sceneId of sceneIds) {
    if (!seenSceneOrder.has(sceneId)) {
      fail(`/scenes/${sceneId}`, `Scene "${sceneId}" is not present in sceneOrder`);
    }
  }

  // --- block membership: exactly one scene owns each block -----------------
  const blockIds = Object.keys(document.blocks);
  if (blockIds.length > limits.maxBlocks) {
    fail("/blocks", `Document has ${blockIds.length} blocks, limit is ${limits.maxBlocks}`);
  }
  const owners = new Map<string, string[]>();

  for (const sceneId of sceneIds) {
    const scene = document.scenes[sceneId];
    if (!scene) continue;
    if (scene.id !== sceneId) {
      fail(`/scenes/${sceneId}/id`, `Object key "${sceneId}" does not equal scene id "${scene.id}"`);
    }
    if (scene.title.length > limits.maxTitleLength) {
      fail(`/scenes/${sceneId}/title`, `Scene title exceeds ${limits.maxTitleLength} characters`);
    }
    if (scene.blockOrder.length > limits.maxBlocksPerScene) {
      fail(
        `/scenes/${sceneId}/blockOrder`,
        `Scene has ${scene.blockOrder.length} blocks, limit is ${limits.maxBlocksPerScene}`,
      );
    }
    const seenInScene = new Set<string>();
    scene.blockOrder.forEach((blockId, index) => {
      if (seenInScene.has(blockId)) {
        fail(
          `/scenes/${sceneId}/blockOrder/${index}`,
          `Block "${blockId}" appears more than once in scene "${sceneId}"`,
        );
      }
      seenInScene.add(blockId);
      if (!document.blocks[blockId]) {
        fail(
          `/scenes/${sceneId}/blockOrder/${index}`,
          `blockOrder references unknown block "${blockId}"`,
        );
      }
      owners.set(blockId, [...(owners.get(blockId) ?? []), sceneId]);
    });
  }

  for (const blockId of blockIds) {
    const block = document.blocks[blockId];
    if (!block) continue;
    if (block.id !== blockId) {
      fail(`/blocks/${blockId}/id`, `Object key "${blockId}" does not equal block id "${block.id}"`);
    }
    const ownedBy = owners.get(blockId) ?? [];
    if (ownedBy.length === 0) {
      fail(`/blocks/${blockId}`, `Block "${blockId}" is orphaned: no scene lists it`);
    } else if (ownedBy.length > 1) {
      // Aliasing across scenes is how one edit silently changes two places.
      fail(
        `/blocks/${blockId}`,
        `Block "${blockId}" is claimed by ${ownedBy.length} scenes (${ownedBy.join(", ")}); a block belongs to one scene`,
      );
    }
    // PRD section 8.1 requires these. Without the check, a block could be
    // committed with no renderer at all — which happened: an agent sent
    // widget-shaped blocks {id, type, title, value, data} to block.add, the
    // fields it did not recognise became undefined, and the document accepted
    // three blocks that nothing could ever render.
    if (typeof block.kind !== "string" || block.kind.length === 0) {
      fail(`/blocks/${blockId}/kind`, 'Block requires a non-empty "kind"');
    }
    if (typeof block.title !== "string") {
      fail(`/blocks/${blockId}/title`, 'Block requires a "title" string');
    } else if (block.title.length > limits.maxTitleLength) {
      fail(`/blocks/${blockId}/title`, `Block title exceeds ${limits.maxTitleLength} characters`);
    }
    if (typeof block.rendererId !== "string" || !/^[a-z0-9]+\.[a-z0-9-]+$/i.test(block.rendererId)) {
      fail(
        `/blocks/${blockId}/rendererId`,
        'Block requires a namespaced "rendererId" such as "workplane.table". ' +
          "A block without one can never be rendered.",
      );
    }
    if (typeof block.specVersion !== "string" || block.specVersion.length === 0) {
      fail(`/blocks/${blockId}/specVersion`, 'Block requires a non-empty "specVersion"');
    }
    if (block.spec === undefined) {
      fail(`/blocks/${blockId}/spec`, 'Block requires a "spec", even if it is an empty object');
    }
    if (typeof block.fallback !== "string") {
      fail(`/blocks/${blockId}/fallback`, 'Block requires "fallback" text for when its renderer is unavailable');
    }
    if (!Array.isArray(block.dataRefs)) {
      fail(`/blocks/${blockId}/dataRefs`, '"dataRefs" must be an array of query ids');
    }
    if (!block.bindings || typeof block.bindings !== "object" || Array.isArray(block.bindings)) {
      fail(`/blocks/${blockId}/bindings`, '"bindings" must be an object');
    }
    const depth = depthOf(block.spec);
    if (depth > limits.maxSpecDepth) {
      fail(`/blocks/${blockId}/spec`, `Spec nests ${depth} deep, limit is ${limits.maxSpecDepth}`);
    }
    const size = byteLength(block.spec);
    if (size > limits.maxSpecBytes) {
      fail(`/blocks/${blockId}/spec`, `Spec is ${size} bytes, limit is ${limits.maxSpecBytes}`);
    }
    for (const queryId of Array.isArray(block.dataRefs) ? block.dataRefs : []) {
      if (!document.queries[queryId]) {
        fail(`/blocks/${blockId}/dataRefs`, `dataRefs references unknown query "${queryId}"`);
      }
    }
    for (const [name, binding] of Object.entries(block.bindings ?? {})) {
      if (binding.path !== "" && !binding.path.startsWith("/")) {
        fail(
          `/blocks/${blockId}/bindings/${name}`,
          `Binding path must be a JSON Pointer starting with "/": "${binding.path}"`,
        );
      }
    }
  }

  // --- queries and artifacts ----------------------------------------------
  for (const [queryId, query] of Object.entries(document.queries)) {
    if (query.id !== queryId) {
      fail(`/queries/${queryId}/id`, `Object key does not equal query id "${query.id}"`);
    }
    if (!document.dataSources[query.dataSourceId]) {
      fail(
        `/queries/${queryId}/dataSourceId`,
        `Query references unknown data source "${query.dataSourceId}"`,
      );
    }
  }
  for (const [sourceId, source] of Object.entries(document.dataSources)) {
    if (source.id !== sourceId) {
      fail(`/dataSources/${sourceId}/id`, `Object key does not equal data source id "${source.id}"`);
    }
  }
  for (const [artifactId, artifact] of Object.entries(document.artifacts)) {
    if (artifact.id !== artifactId) {
      fail(`/artifacts/${artifactId}/id`, `Object key does not equal artifact id "${artifact.id}"`);
    }
  }

  const sharedBytes = byteLength(document.shared);
  if (sharedBytes > limits.maxSharedBytes) {
    fail("/shared", `Shared state is ${sharedBytes} bytes, limit is ${limits.maxSharedBytes}`);
  }

  return violations.length === 0
    ? { ok: true, value: document }
    : { ok: false, violations };
}
