import type { JsonValue } from "../protocol/index.js";

/**
 * A deliberately small schema language for writable values.
 *
 * Absent by design: `$ref`, `oneOf`/`anyOf`/`allOf`/`not`, `additionalProperties: true`,
 * and any form of expression. Those turn validation into an interpreter, and an
 * interpreter over agent-supplied input is the thing this exists to avoid.
 *
 * Schemas are HOST-AUTHORED — they arrive with the document policy, never from
 * a document, an agent, or a browser. Values are the untrusted side.
 */
export type ValueSchema =
  | {
      type: "string";
      enum?: readonly string[];
      minLength?: number;
      maxLength?: number;
      /** Host-authored only. Keep it anchored and simple. */
      pattern?: string;
    }
  | { type: "number"; minimum?: number; maximum?: number; enum?: readonly number[] }
  | { type: "integer"; minimum?: number; maximum?: number; enum?: readonly number[] }
  | { type: "boolean" }
  | { type: "array"; items: ValueSchema; minItems?: number; maxItems?: number }
  | {
      type: "object";
      properties: Record<string, ValueSchema>;
      required?: readonly string[];
      /** Always closed. Present for readability, not configurability. */
      additionalProperties?: false;
    };

export interface SchemaViolation {
  /** JSON Pointer into the VALUE, so a caller can point at the bad field. */
  path: string;
  message: string;
}

/** Bounds on the untrusted value, independent of what the schema allows. */
export interface ValueLimits {
  maxDepth: number;
  maxNodes: number;
  maxStringLength: number;
}

export const DEFAULT_VALUE_LIMITS: ValueLimits = {
  maxDepth: 8,
  maxNodes: 512,
  maxStringLength: 4096,
};

interface Ctx {
  limits: ValueLimits;
  nodes: number;
  violations: SchemaViolation[];
}

function fail(ctx: Ctx, path: string, message: string): void {
  ctx.violations.push({ path, message });
}

function check(schema: ValueSchema, value: JsonValue, path: string, depth: number, ctx: Ctx): void {
  if (depth > ctx.limits.maxDepth) {
    fail(ctx, path, `Value nests deeper than ${ctx.limits.maxDepth}`);
    return;
  }
  if (++ctx.nodes > ctx.limits.maxNodes) {
    fail(ctx, path, `Value has more than ${ctx.limits.maxNodes} nodes`);
    return;
  }

  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") {
        fail(ctx, path, "Expected a string");
        return;
      }
      if (value.length > ctx.limits.maxStringLength) {
        fail(ctx, path, `String exceeds ${ctx.limits.maxStringLength} characters`);
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        fail(ctx, path, `String is shorter than ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        fail(ctx, path, `String is longer than ${schema.maxLength}`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        fail(ctx, path, "Value is not one of the permitted options");
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        fail(ctx, path, "Value does not match the required format");
      }
      return;
    }

    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(ctx, path, "Expected a finite number");
        return;
      }
      if (schema.type === "integer" && !Number.isInteger(value)) {
        fail(ctx, path, "Expected an integer");
        return;
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        fail(ctx, path, `Value is below the minimum ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        fail(ctx, path, `Value is above the maximum ${schema.maximum}`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        fail(ctx, path, "Value is not one of the permitted options");
      }
      return;
    }

    case "boolean": {
      if (typeof value !== "boolean") fail(ctx, path, "Expected a boolean");
      return;
    }

    case "array": {
      if (!Array.isArray(value)) {
        fail(ctx, path, "Expected an array");
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        fail(ctx, path, `Array needs at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        fail(ctx, path, `Array allows at most ${schema.maxItems} items`);
        return;
      }
      value.forEach((item, index) => check(schema.items, item, `${path}/${index}`, depth + 1, ctx));
      return;
    }

    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        fail(ctx, path, "Expected an object");
        return;
      }
      const record = value as Record<string, JsonValue>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) fail(ctx, `${path}/${key}`, "Required property is missing");
      }
      for (const [key, child] of Object.entries(record)) {
        const childSchema = schema.properties[key];
        if (!childSchema) {
          // Closed by construction: an unknown field is rejected rather than
          // carried along, so a renderer never has to defend against one.
          fail(ctx, `${path}/${key}`, "Unknown property is not permitted");
          continue;
        }
        check(childSchema, record[key] as JsonValue, `${path}/${key}`, depth + 1, ctx);
      }
      return;
    }
  }
}

export function validateValue(
  schema: ValueSchema,
  value: JsonValue,
  limits: ValueLimits = DEFAULT_VALUE_LIMITS,
): { ok: true } | { ok: false; violations: SchemaViolation[] } {
  const ctx: Ctx = { limits, nodes: 0, violations: [] };
  check(schema, value, "", 0, ctx);
  return ctx.violations.length === 0 ? { ok: true } : { ok: false, violations: ctx.violations };
}

/** Short, non-sensitive description of a schema, for agent catalogue context. */
export function describeSchema(schema: ValueSchema): string {
  switch (schema.type) {
    case "string":
      return schema.enum ? `string(${schema.enum.join("|")})` : "string";
    case "number":
    case "integer": {
      const range =
        schema.minimum !== undefined || schema.maximum !== undefined
          ? `[${schema.minimum ?? ""}..${schema.maximum ?? ""}]`
          : "";
      return `${schema.type}${range}`;
    }
    case "boolean":
      return "boolean";
    case "array":
      return `${describeSchema(schema.items)}[]`;
    case "object":
      return `{${Object.keys(schema.properties).join(",")}}`;
  }
}
