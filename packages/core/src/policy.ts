import { parsePointer, type Actor, type JsonValue, type Operation } from "@bahulam/workplane-protocol";

export type WritableType = "string" | "number" | "integer" | "boolean" | "string[]";

/**
 * A registered, typed write path within `shared`. Clients cannot write
 * arbitrary document roots; a path absent from this registry is rejected even
 * for an actor who may otherwise edit the document.
 *
 * `path` supports a single trailing `/*` wildcard for one dynamic segment,
 * e.g. `/selection/*` — not arbitrary glob nesting.
 */
export interface WritablePath {
  path: string;
  type: WritableType;
  /** Capability an actor needs to write here. Omit for "any editor". */
  capability?: string;
  min?: number;
  max?: number;
  /** Closed value set, for select-style inputs. */
  enum?: readonly (string | number)[];
}

export interface DocumentPolicy {
  writablePaths: readonly WritablePath[];
  /** Structural edits (scene/block add, move, remove) require this. */
  structuralCapability?: string;
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

function typeOk(type: WritableType, value: JsonValue): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "string[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
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

  operations.forEach((operation, index) => {
    const path = `/operations/${index}`;

    if (operation.op === "state.set") {
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
      if (!typeOk(rule.type, operation.value)) {
        denials.push({
          path: `${path}/value`,
          message: `"${operation.path}" is typed ${rule.type}`,
        });
        return;
      }
      if (typeof operation.value === "number") {
        if (rule.min !== undefined && operation.value < rule.min) {
          denials.push({ path: `${path}/value`, message: `Value is below the minimum ${rule.min}` });
        }
        if (rule.max !== undefined && operation.value > rule.max) {
          denials.push({ path: `${path}/value`, message: `Value is above the maximum ${rule.max}` });
        }
      }
      if (rule.enum && (typeof operation.value === "string" || typeof operation.value === "number")) {
        if (!rule.enum.includes(operation.value)) {
          denials.push({
            path: `${path}/value`,
            message: `Value is not one of the permitted options for "${operation.path}"`,
          });
        }
      }
      // A malformed pointer is a validation failure, not a silent no-op.
      try {
        parsePointer(operation.path);
      } catch (error) {
        denials.push({ path: `${path}/path`, message: (error as Error).message });
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
