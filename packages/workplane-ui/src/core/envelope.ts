import type { JsonValue } from "../protocol/index.js";

/**
 * The renderer envelope.
 *
 * Workplane owns the safety properties of a block specification. It does NOT
 * own the visual grammar — PRD-108 VC-05. ECharts speaks ECharts, Vega-Lite
 * speaks Vega-Lite, a 3D adapter takes a scene graph, and nothing translates
 * between them. What is uniform is this: no executable content, no fetching, no
 * prototype tampering, bounded size, and a closed set of accepted keys.
 *
 * Built once, generically, so a new engine costs an adapter rather than a fresh
 * argument about what an agent may send.
 */

/** What an adapter accepts, as a tree of permitted keys. */
export type KeyTree =
  /** Any JSON value here, still subject to the safety rules and limits. */
  | true
  /**
   * A string the renderer guarantees to display VERBATIM — as a text node,
   * never parsed, never interpreted, never used as a URL.
   *
   * The content rules exist because a renderer must not fetch and must not
   * execute. A string that is only ever shown as characters can do neither, so
   * they do not apply: a code sample legitimately contains `=>`, and lesson
   * prose legitimately mentions a URL. Length and byte limits still apply.
   *
   * An adapter declaring this is making a promise. Using it for anything that
   * reaches innerHTML, a src, or an href is a defect in that adapter.
   */
  | { readonly $verbatim: true }
  /** An object with exactly these keys; anything else is dropped. */
  | { readonly [key: string]: KeyTree }
  /**
   * An array whose every item follows the inner tree.
   *
   * `orSingle` accepts a lone object and normalizes it to a one-element array,
   * for engines that accept either. Being stricter than the engine means
   * rejecting input that is correct for it, which is a worse failure than
   * accepting a shape we then normalize.
   */
  | { readonly $array: KeyTree; readonly orSingle?: boolean };

export interface SpecLimits {
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
  maxArrayLength: number;
  maxStringLength: number;
}

export const DEFAULT_SPEC_LIMITS: SpecLimits = {
  maxDepth: 12,
  maxNodes: 20_000,
  maxBytes: 256 * 1024,
  maxArrayLength: 5_000,
  maxStringLength: 4_096,
};

export interface SpecViolation {
  /** JSON Pointer into the submitted spec. */
  path: string;
  message: string;
}

export type SanitizeResult<T = JsonValue> =
  | { ok: true; value: T; dropped: string[] }
  | { ok: false; violations: SpecViolation[]; dropped: string[] };

/**
 * Keys that can poison an object when a spec is merged into one.
 * JSON.parse does not create them as real prototype links, but a spec reaches
 * renderers that may spread or merge it, and a key named `__proto__` surviving
 * that far is a hazard for no benefit.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Strings a renderer must never be handed.
 *
 * A renderer does not fetch. Every byte it draws comes from an authorized query
 * result or a host-resolved artifact, so any URL inside a spec is either a
 * mistake or an attempt to make the browser request something on the document's
 * behalf. `image://` is ECharts' own symbol-image syntax, which is exactly that.
 */
// Unanchored: a URL buried mid-string is the interesting case, not one at the
// start. `"() => fetch('https://…')"` is exactly what an anchored check misses.
const URLISH = /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"']|(?:javascript|data|blob|file|image)\s*:/i;

/** Template placeholders ECharts and others use are fine; code is not. */
// An arrow does not need a brace to be a function, and a spec has no legitimate
// reason to contain one — ECharts formatters that survive JSON are templates.
const SCRIPT_ISH = /<\s*script|\bon[a-z]+\s*=|\bfunction\s*\(|=>|\beval\s*\(|\bnew\s+Function/i;

interface Ctx {
  limits: SpecLimits;
  nodes: number;
  violations: SpecViolation[];
  dropped: string[];
}

function checkString(value: string, path: string, ctx: Ctx): boolean {
  if (value.length > ctx.limits.maxStringLength) {
    ctx.violations.push({ path, message: `String exceeds ${ctx.limits.maxStringLength} characters` });
    return false;
  }
  if (URLISH.test(value)) {
    ctx.violations.push({
      path,
      message:
        "A specification may not contain a URL. A renderer never fetches — data comes from an " +
        "authorized query result, and assets from a host-resolved artifact id.",
    });
    return false;
  }
  if (SCRIPT_ISH.test(value)) {
    ctx.violations.push({ path, message: "A specification may not contain executable content" });
    return false;
  }
  return true;
}

function walk(tree: KeyTree, value: JsonValue, path: string, depth: number, ctx: Ctx): JsonValue | undefined {
  if (depth > ctx.limits.maxDepth) {
    ctx.violations.push({ path, message: `Nests deeper than ${ctx.limits.maxDepth}` });
    return undefined;
  }
  if (++ctx.nodes > ctx.limits.maxNodes) {
    ctx.violations.push({ path, message: `Specification has more than ${ctx.limits.maxNodes} nodes` });
    return undefined;
  }

  const verbatim = tree !== true && typeof tree === "object" && "$verbatim" in tree;
  if (typeof value === "string") {
    if (verbatim) {
      if (value.length > ctx.limits.maxStringLength) {
        ctx.violations.push({ path, message: `String exceeds ${ctx.limits.maxStringLength} characters` });
        return undefined;
      }
      return value;
    }
    return checkString(value, path, ctx) ? value : undefined;
  }
  if (verbatim) {
    ctx.violations.push({ path, message: "A string is required here" });
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      ctx.violations.push({ path, message: "Numbers must be finite" });
      return undefined;
    }
    return value;
  }
  if (value === null || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    if (value.length > ctx.limits.maxArrayLength) {
      ctx.violations.push({ path, message: `Array exceeds ${ctx.limits.maxArrayLength} items` });
      return undefined;
    }
    const inner: KeyTree | undefined =
      tree === true ? true : typeof tree === "object" && "$array" in tree ? tree.$array : undefined;
    if (inner === undefined) {
      ctx.violations.push({ path, message: "An array is not permitted here" });
      return undefined;
    }
    const out: JsonValue[] = [];
    value.forEach((item, index) => {
      const kept = walk(inner, item as JsonValue, `${path}/${index}`, depth + 1, ctx);
      if (kept !== undefined) out.push(kept);
    });
    return out;
  }

  // Object.
  const record = value as { [k: string]: JsonValue };
  if (tree !== true && typeof tree === "object" && "$array" in tree) {
    if (tree.orSingle) {
      const single = walk(tree.$array, value, path, depth, ctx);
      return single === undefined ? undefined : [single];
    }
    ctx.violations.push({
      path,
      message: "An array is required here; wrap this object in [ ] or send a list",
    });
    return undefined;
  }
  const out: { [k: string]: JsonValue } = {};
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (FORBIDDEN_KEYS.has(key)) {
      ctx.violations.push({ path: childPath, message: `Key "${key}" is not permitted` });
      continue;
    }
    const childTree: KeyTree | undefined =
      tree === true ? true : (tree as { [k: string]: KeyTree })[key];
    if (childTree === undefined) {
      // Unknown keys are DROPPED, not rejected. An adapter that grows a new
      // option should not break every document written before it existed, and
      // silently passing an unknown key through to an engine is how a spec
      // smuggles behaviour past the allowlist.
      ctx.dropped.push(childPath);
      continue;
    }
    const kept = walk(childTree, child, childPath, depth + 1, ctx);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/**
 * Apply the envelope to one specification.
 *
 * Returns the SANITIZED value: unknown keys removed, everything retained
 * checked. Violations are hard failures — a URL, executable content, a
 * forbidden key, or a breached limit — as distinct from drops, which are
 * merely keys this adapter does not know about.
 */
export function sanitizeSpec<T = JsonValue>(
  spec: unknown,
  options: { allow: KeyTree; limits?: SpecLimits },
): SanitizeResult<T> {
  const limits = options.limits ?? DEFAULT_SPEC_LIMITS;
  const ctx: Ctx = { limits, nodes: 0, violations: [], dropped: [] };

  let text: string;
  try {
    text = JSON.stringify(spec ?? null);
  } catch {
    return {
      ok: false,
      dropped: [],
      violations: [{ path: "", message: "Specification is not JSON-serializable" }],
    };
  }
  if (text.length > limits.maxBytes) {
    return {
      ok: false,
      dropped: [],
      violations: [{ path: "", message: `Specification is ${text.length} bytes, limit is ${limits.maxBytes}` }],
    };
  }

  // Re-parse so anything non-JSON — a function, a Date, undefined — is already
  // gone before validation, rather than being validated and then lost.
  const plain = JSON.parse(text) as JsonValue;
  const value = walk(options.allow, plain, "", 0, ctx);

  if (ctx.violations.length > 0) {
    return { ok: false, violations: ctx.violations, dropped: ctx.dropped };
  }
  return { ok: true, value: value as T, dropped: ctx.dropped };
}

/** Human-readable shape of what an adapter accepts, for catalog discovery. */
export function describeKeyTree(tree: KeyTree, depth = 0): string {
  if (tree === true) return "any";
  if (typeof tree === "object" && "$verbatim" in tree) return "text";
  if (typeof tree === "object" && "$array" in tree) {
    return `[${describeKeyTree(tree.$array, depth + 1)}]`;
  }
  const keys = Object.keys(tree as { [k: string]: KeyTree });
  if (depth >= 2) return `{${keys.join(",")}}`;
  return `{${keys
    .map((k) => `${k}: ${describeKeyTree((tree as { [k: string]: KeyTree })[k] as KeyTree, depth + 1)}`)
    .join(", ")}}`;
}
