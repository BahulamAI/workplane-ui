import {
  formatPointer,
  parsePointer,
  setPointer,
  type Anchor,
  type JsonObject,
  type Operation,
  type SceneInput,
  type BlockInput,
} from "../protocol/index.js";
import type { Block, Scene, WorkplaneDocument } from "./document.js";
import { sceneIdOfBlock } from "./document.js";

export class ReducerError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(message);
    this.name = "ReducerError";
    this.path = path;
  }
}

/**
 * Resolve an anchor into an insertion index.
 *   undefined -> append        null -> prepend        id -> after that id
 * A supplied id that is not in `order` is rejected rather than appended,
 * because silently appending is how an agent's mis-targeted insert ends up
 * somewhere plausible-looking and wrong.
 */
function resolveIndex(order: readonly string[], anchor: Anchor, path: string): number {
  if (anchor === undefined) return order.length;
  if (anchor === null) return 0;
  const index = order.indexOf(anchor);
  if (index === -1) {
    throw new ReducerError(path, `Anchor "${anchor}" is not present in the target container`);
  }
  return index + 1;
}

function requireScene(document: WorkplaneDocument, sceneId: string, path: string): Scene {
  const scene = document.scenes[sceneId];
  if (!scene) throw new ReducerError(path, `Unknown scene "${sceneId}"`);
  return scene;
}

function requireBlock(document: WorkplaneDocument, blockId: string, path: string): Block {
  const block = document.blocks[blockId];
  if (!block) throw new ReducerError(path, `Unknown block "${blockId}"`);
  return block;
}

function materializeScene(input: SceneInput): Scene {
  return {
    id: input.id,
    title: input.title,
    layout: input.layout ?? "flow",
    blockOrder: [],
    parameters: input.parameters ?? {},
  };
}

function materializeBlock(input: BlockInput): Block {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    rendererId: input.rendererId,
    specVersion: input.specVersion,
    spec: input.spec,
    bindings: input.bindings ?? {},
    dataRefs: input.dataRefs ?? [],
    fallback: input.fallback ?? input.title,
  };
}

/**
 * Apply one operation to a document, returning a new document.
 *
 * Pure: no clock, no randomness, no I/O, no mutation of the input. The same
 * document and operation always produce the same result, which is what makes
 * the authority's "apply to a copy, then validate" step meaningful.
 */
export function applyOperation(
  document: WorkplaneDocument,
  operation: Operation,
  path: string,
): WorkplaneDocument {
  switch (operation.op) {
    case "scene.add": {
      const { scene, afterSceneId } = operation;
      if (document.scenes[scene.id]) {
        throw new ReducerError(`${path}/scene/id`, `Scene "${scene.id}" already exists`);
      }
      const index = resolveIndex(document.sceneOrder, afterSceneId, `${path}/afterSceneId`);
      const sceneOrder = [...document.sceneOrder];
      sceneOrder.splice(index, 0, scene.id);
      return {
        ...document,
        sceneOrder,
        scenes: { ...document.scenes, [scene.id]: materializeScene(scene) },
      };
    }

    case "scene.update": {
      const scene = requireScene(document, operation.sceneId, `${path}/sceneId`);
      const next: Scene = { ...scene };
      if (operation.patch.title !== undefined) next.title = operation.patch.title;
      if (operation.patch.layout !== undefined) next.layout = operation.patch.layout;
      if (operation.patch.parameters !== undefined) next.parameters = operation.patch.parameters;
      return { ...document, scenes: { ...document.scenes, [scene.id]: next } };
    }

    case "scene.remove": {
      const scene = requireScene(document, operation.sceneId, `${path}/sceneId`);
      const mode = operation.blocks ?? "reject";
      if (scene.blockOrder.length > 0 && mode === "reject") {
        throw new ReducerError(
          `${path}/sceneId`,
          `Scene "${scene.id}" still holds ${scene.blockOrder.length} blocks; pass blocks:"cascade" to remove them`,
        );
      }
      const scenes = { ...document.scenes };
      delete scenes[scene.id];
      const blocks = { ...document.blocks };
      for (const blockId of scene.blockOrder) delete blocks[blockId];
      return {
        ...document,
        sceneOrder: document.sceneOrder.filter((id) => id !== scene.id),
        scenes,
        blocks,
      };
    }

    case "scene.move": {
      const scene = requireScene(document, operation.sceneId, `${path}/sceneId`);
      if (operation.afterSceneId === scene.id) {
        throw new ReducerError(`${path}/afterSceneId`, "A scene cannot be moved relative to itself");
      }
      const without = document.sceneOrder.filter((id) => id !== scene.id);
      const index = resolveIndex(without, operation.afterSceneId, `${path}/afterSceneId`);
      const sceneOrder = [...without];
      sceneOrder.splice(index, 0, scene.id);
      return { ...document, sceneOrder };
    }

    case "block.add": {
      const scene = requireScene(document, operation.sceneId, `${path}/sceneId`);
      const { block, afterBlockId } = operation;
      if (document.blocks[block.id]) {
        throw new ReducerError(`${path}/block/id`, `Block "${block.id}" already exists`);
      }
      const index = resolveIndex(scene.blockOrder, afterBlockId, `${path}/afterBlockId`);
      const blockOrder = [...scene.blockOrder];
      blockOrder.splice(index, 0, block.id);
      return {
        ...document,
        scenes: { ...document.scenes, [scene.id]: { ...scene, blockOrder } },
        blocks: { ...document.blocks, [block.id]: materializeBlock(block) },
      };
    }

    case "block.update": {
      const block = requireBlock(document, operation.blockId, `${path}/blockId`);
      const next: Block = { ...block };
      const { patch } = operation;
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.spec !== undefined) next.spec = patch.spec;
      if (patch.bindings !== undefined) next.bindings = patch.bindings;
      if (patch.dataRefs !== undefined) next.dataRefs = patch.dataRefs;
      if (patch.fallback !== undefined) next.fallback = patch.fallback;
      return { ...document, blocks: { ...document.blocks, [block.id]: next } };
    }

    case "block.remove": {
      const block = requireBlock(document, operation.blockId, `${path}/blockId`);
      const ownerId = sceneIdOfBlock(document, block.id);
      const blocks = { ...document.blocks };
      delete blocks[block.id];
      const scenes = { ...document.scenes };
      if (ownerId) {
        const owner = scenes[ownerId] as Scene;
        scenes[ownerId] = {
          ...owner,
          blockOrder: owner.blockOrder.filter((id) => id !== block.id),
        };
      }
      return { ...document, scenes, blocks };
    }

    case "block.move": {
      const block = requireBlock(document, operation.blockId, `${path}/blockId`);
      const target = requireScene(document, operation.sceneId, `${path}/sceneId`);
      if (operation.afterBlockId === block.id) {
        throw new ReducerError(`${path}/afterBlockId`, "A block cannot be moved relative to itself");
      }
      const sourceId = sceneIdOfBlock(document, block.id);
      const scenes = { ...document.scenes };
      if (sourceId) {
        const source = scenes[sourceId] as Scene;
        scenes[sourceId] = {
          ...source,
          blockOrder: source.blockOrder.filter((id) => id !== block.id),
        };
      }
      const destination = scenes[target.id] as Scene;
      const index = resolveIndex(destination.blockOrder, operation.afterBlockId, `${path}/afterBlockId`);
      const blockOrder = [...destination.blockOrder];
      blockOrder.splice(index, 0, block.id);
      scenes[target.id] = { ...destination, blockOrder };
      return { ...document, scenes };
    }

    case "state.set": {
      // Explicitly relative to `shared`, never the document root. There is no
      // operation that lets a client write /revision or /dataSources.
      const tokens = parsePointer(operation.path);
      if (tokens.length === 0) {
        throw new ReducerError(`${path}/path`, "state.set requires a path within shared state");
      }
      const shared = setPointer(document.shared, formatPointer(tokens), operation.value);
      return { ...document, shared: shared as JsonObject };
    }

    default: {
      const unreachable = operation as { op: string };
      throw new ReducerError(`${path}/op`, `Unsupported operation "${unreachable.op}"`);
    }
  }
}

/**
 * Apply every operation in order. Either all of them land or none do — the
 * caller receives a new document only if the whole sequence succeeded, so a
 * transaction with one bad operation leaves no partial durable change.
 */
export function applyOperations(
  document: WorkplaneDocument,
  operations: readonly Operation[],
): WorkplaneDocument {
  let next = document;
  operations.forEach((operation, index) => {
    next = applyOperation(next, operation, `/operations/${index}`);
  });
  return next;
}
