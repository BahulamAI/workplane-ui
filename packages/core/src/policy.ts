import { parsePointer, type Actor, type Operation } from "@bahulam/workplane-protocol";
import {
  DEFAULT_VALUE_LIMITS,
  describeSchema,
  validateValue,
  type ValueLimits,
  type ValueSchema,
} from "./schema.js";

/**
 * A registered, typed write path within `shared`.
 *
 * Clients cannot write arbitrary document roots: a path absent from this
 * registry is rejected even for an actor who may otherwise edit the document.
 *
 * `path` supports a single trailing `/*` wildcard for one dynamic segment,
 * e.g. `/selection/*` — not arbitrary glob nesting.
 */
export interface WritablePath {
  path: string;
  /** Host-authored schema. Objects and arrays are permitted, unlike v0.1. */
  schema: ValueSchema;
  /** Capability an actor needs to write here. Omit for "any editor". */
  capability?: string;
}

export interface DocumentPolicy {
  writablePaths: readonly WritablePath[];
  /** Structural edits (scene/block add, move, remove) require this. */
  structuralCapability?: string;
  /** Bounds on untrusted values, independent of the schemas. */
  valueLimits?: ValueLimits;
}

export interface PolicyDenial {
  path: string;
  message: string;
}

function matches(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (!pattern.endsWith("/*")) return false;
  const prefix = pattern.slice(0, -1);
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}

/**
 * Authorize one transaction's operations against the document policy.
 *
 * The same policy runs for an agent proposal and a button click. A renderer
 * that hides a control has not authorized anything; this is where the decision
 * is actually made.
 */
export function authorizeOperations(
  operations: readonly Operation[],
  actor: Actor,
  policy: DocumentPolicy,
): PolicyDenial[] {
  const denials: PolicyDenial[] = [];
  const held = new Set(actor.capabilities);
  const limits = policy.valueLimits ?? DEFAULT_VALUE_LIMITS;

  operations.forEach((operation, index) => {
    const path = `/operations/${index}`;

    if (operation.op === "state.set") {
      // A malformed pointer is a validation failure, not a silent no-op.
      try {
        parsePointer(operation.path);
      } catch (error) {
        denials.push({ path: `${path}/path`, message: (error as Error).message });
        return;
      }

      const rule = policy.writablePaths.find((w) => matches(w.path, operation.path));
      if (!rule) {
        denials.push({
          path: `${path}/path`,
          message: `"${operation.path}" is not a registered writable path`,
        });
        return;
      }
      if (rule.capability && !held.has(rule.capability)) {
        denials.push({
          path: `${path}/path`,
          message: `Writing "${operation.path}" requires capability "${rule.capability}"`,
        });
        return;
      }

      const validation = validateValue(rule.schema, operation.value, limits);
      if (!validation.ok) {
        const first = validation.violations[0] as { path: string; message: string };
        denials.push({
          // Point at the offending field inside the value, not just the write.
          path: `${path}/value${first.path}`,
          message: first.message,
        });
      }
      return;
    }

    const capability = policy.structuralCapability;
    if (capability && !held.has(capability)) {
      denials.push({
        path,
        message: `Operation "${operation.op}" requires capability "${capability}"`,
      });
    }
  });

  return denials;
}

/** Compact, non-sensitive description of the write surface, for agent context. */
export function describeWritablePaths(
  policy: DocumentPolicy,
): Array<{ path: string; schema: string }> {
  return policy.writablePaths.map((rule) => ({
    path: rule.path,
    schema: describeSchema(rule.schema),
  }));
}
