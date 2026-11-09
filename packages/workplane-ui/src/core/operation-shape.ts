import type { Operation } from "../protocol/index.js";
import type { Violation } from "./validate.js";

/**
 * Check that an operation carries the fields its kind requires.
 *
 * The reducer assumes well-formed operations, so a missing field surfaces as a
 * TypeError deep inside it — which the gateway could only report as "the
 * transaction could not be applied". An agent given that has nothing to repair.
 *
 * Checked BEFORE the reducer runs, so the answer is a path into the submitted
 * transaction: `/operations/0/scene` beats a stack trace.
 */

const OPERATIONS = new Set([
  "scene.add", "scene.update", "scene.remove", "scene.move",
  "block.add", "block.update", "block.remove", "block.move", "state.set",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(value: unknown, path: string, what: string, out: Violation[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    out.push({ path, message: `${what} is required and must be a non-empty string` });
  }
}

export function validateOperationShape(operation: unknown, index: number): Violation[] {
  const at = `/operations/${index}`;
  const out: Violation[] = [];

  if (!isObject(operation)) {
    return [{ path: at, message: "Each operation must be an object" }];
  }
  const op = String(operation.op ?? "");
  if (!OPERATIONS.has(op)) {
    return [{
      path: `${at}/op`,
      message: `Unsupported operation ${JSON.stringify(operation.op ?? null)}. Use one of: ${[...OPERATIONS].join(", ")}`,
    }];
  }

  switch (op) {
    case "scene.add": {
      if (!isObject(operation.scene)) {
        out.push({ path: `${at}/scene`, message: 'scene.add requires "scene": { id, title, layout? }' });
        break;
      }
      requireId(operation.scene.id, `${at}/scene/id`, '"id"', out);
      if (typeof operation.scene.title !== "string") {
        out.push({ path: `${at}/scene/title`, message: '"title" is required' });
      }
      break;
    }
    case "scene.update":
      requireId(operation.sceneId, `${at}/sceneId`, '"sceneId"', out);
      if (!isObject(operation.patch)) {
        out.push({ path: `${at}/patch`, message: 'scene.update requires "patch": { title?, layout?, parameters? }' });
      }
      break;
    case "scene.remove":
    case "scene.move":
      requireId(operation.sceneId, `${at}/sceneId`, '"sceneId"', out);
      break;

    case "block.add": {
      requireId(operation.sceneId, `${at}/sceneId`, '"sceneId"', out);
      if (!isObject(operation.block)) {
        out.push({
          path: `${at}/block`,
          message:
            'block.add requires "block": { id, kind, title, rendererId, specVersion, spec }. ' +
            "Widget shapes such as { id, type, value, data } are not blocks.",
        });
        break;
      }
      const block = operation.block;

      // A widget sent where a block belongs is a specific, recurring mistake
      // with a specific fix, so say which shape was seen rather than listing
      // four missing fields and leaving the cause to be inferred.
      const looksLikeWidget =
        block.kind === undefined &&
        block.rendererId === undefined &&
        (block.type !== undefined || block.value !== undefined || block.data !== undefined);
      if (looksLikeWidget) {
        out.push({
          path: `${at}/block`,
          message:
            "This is a widget, not a block. Widget shapes such as { id, type, value, data } are not " +
            "accepted; a block is { id, kind, title, rendererId, specVersion, spec }. For example a " +
            'metric widget { id, type: "metric", value: 7 } becomes { id, kind: "content.metric", ' +
            'title, rendererId: "workplane.metric", specVersion: "1", spec: { value: 700 } } — and ' +
            "inline money is integer minor units. Call workplane_inspect for the renderer catalog.",
        });
      }

      requireId(block.id, `${at}/block/id`, '"id"', out);
      requireId(block.kind, `${at}/block/kind`, '"kind"', out);
      requireId(block.rendererId, `${at}/block/rendererId`, '"rendererId"', out);
      requireId(block.specVersion, `${at}/block/specVersion`, '"specVersion"', out);
      if (typeof block.title !== "string") {
        out.push({ path: `${at}/block/title`, message: '"title" is required' });
      }
      if (block.spec === undefined) {
        out.push({ path: `${at}/block/spec`, message: '"spec" is required, even if it is an empty object' });
      }
      break;
    }
    case "block.update":
      requireId(operation.blockId, `${at}/blockId`, '"blockId"', out);
      if (!isObject(operation.patch)) {
        out.push({
          path: `${at}/patch`,
          message: 'block.update requires "patch": { title?, spec?, bindings?, dataRefs?, fallback? }',
        });
      }
      break;
    case "block.remove":
      requireId(operation.blockId, `${at}/blockId`, '"blockId"', out);
      break;
    case "block.move":
      requireId(operation.blockId, `${at}/blockId`, '"blockId"', out);
      requireId(operation.sceneId, `${at}/sceneId`, '"sceneId"', out);
      break;

    case "state.set": {
      const path = operation.path;
      if (typeof path !== "string" || !path.startsWith("/")) {
        out.push({
          path: `${at}/path`,
          message:
            '"path" must be a JSON Pointer starting with "/", relative to shared state — ' +
            `for example "/filters/period". Received ${JSON.stringify(path ?? null)}.`,
        });
      }
      if (operation.value === undefined) {
        out.push({ path: `${at}/value`, message: '"value" is required (use null to store an empty value)' });
      }
      break;
    }
  }
  return out;
}

/** Shape-check a whole transaction, reporting every problem at once. */
export function validateOperations(operations: readonly unknown[]): Violation[] {
  return operations.flatMap((operation, index) => validateOperationShape(operation, index));
}

export type { Operation };
