import type { JsonObject, JsonValue } from "./json.js";

/**
 * RFC 6901 JSON Pointer, restricted to what the document model needs.
 * There is no pointer evaluation against arbitrary JavaScript, and no
 * expression language here by design.
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`JSON Pointer must start with "/": ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function formatPointer(tokens: readonly string[]): string {
  if (tokens.length === 0) return "";
  return `/${tokens
    .map((t) => t.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/")}`;
}

export function getPointer(root: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = root;
  for (const token of parsePointer(pointer)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as JsonObject)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Returns a structurally-shared copy with `pointer` set to `value`.
 * Only the containers along the path are cloned; siblings keep identity, so a
 * renderer bound to an untouched subtree does not re-render.
 *
 * Intermediate objects are created when missing. Arrays are never created
 * implicitly — writing into a non-existent array is a caller error, because
 * guessing the container type is how documents quietly corrupt.
 */
export function setPointer(
  root: JsonObject,
  pointer: string,
  value: JsonValue,
): JsonObject {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    throw new Error("Cannot replace the document root through a pointer write");
  }
  const clone = { ...root };
  let cursor: JsonObject = clone;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i] as string;
    const next = cursor[token];
    if (next === undefined || next === null) {
      const created: JsonObject = {};
      cursor[token] = created;
      cursor = created;
    } else if (Array.isArray(next)) {
      const copy = [...next];
      cursor[token] = copy;
      const index = Number(tokens[i + 1]);
      if (!Number.isInteger(index)) {
        throw new Error(`Array at ${formatPointer(tokens.slice(0, i + 1))} needs a numeric index`);
      }
      // Arrays hold values, not further named containers: handled at the leaf.
      cursor = copy as unknown as JsonObject;
    } else if (typeof next === "object") {
      const copy = { ...(next as JsonObject) };
      cursor[token] = copy;
      cursor = copy;
    } else {
      throw new Error(
        `Cannot write through scalar at ${formatPointer(tokens.slice(0, i + 1))}`,
      );
    }
  }
  cursor[tokens[tokens.length - 1] as string] = value;
  return clone;
}
