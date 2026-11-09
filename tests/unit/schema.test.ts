import { describe, expect, it } from "vitest";
import { LocalAuthority, MemoryStorage, validateValue, type ValueSchema } from "@bahulam/workplane-ui";
import { createDemoDocument, DEMO_POLICY, DEMO_USER, transaction } from "@bahulam/workplane-ui/testkit";

const CRITERION: ValueSchema = {
  type: "object",
  required: ["dimension", "operator", "values"],
  properties: {
    dimension: { type: "string", enum: ["service", "environment", "period"] },
    operator: { type: "string", enum: ["in", "not-in"] },
    values: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 25 },
  },
};

function messages(schema: ValueSchema, value: unknown): string[] {
  const result = validateValue(schema, value as never);
  return result.ok ? [] : result.violations.map((v) => `${v.path}: ${v.message}`);
}

describe("value schema", () => {
  it("accepts a well-formed nested object", () => {
    expect(
      messages(CRITERION, { dimension: "service", operator: "in", values: ["compute"] }),
    ).toEqual([]);
  });

  it("reports the offending field, not just the write", () => {
    expect(messages(CRITERION, { dimension: "nope", operator: "in", values: [] })).toEqual([
      "/dimension: Value is not one of the permitted options",
    ]);
  });

  it("names a missing required property", () => {
    expect(messages(CRITERION, { dimension: "service" })).toContain(
      "/operator: Required property is missing",
    );
  });

  it("rejects an unknown property instead of carrying it through", () => {
    const result = messages(CRITERION, {
      dimension: "service",
      operator: "in",
      values: [],
      onClick: "alert(1)",
    });
    expect(result).toContain("/onClick: Unknown property is not permitted");
  });

  it("validates inside arrays with an indexed path", () => {
    expect(
      messages({ type: "array", items: CRITERION }, [
        { dimension: "service", operator: "in", values: [] },
        { dimension: "service", operator: "sideways", values: [] },
      ]),
    ).toEqual(["/1/operator: Value is not one of the permitted options"]);
  });

  it("distinguishes integer from number", () => {
    expect(messages({ type: "integer" }, 1.5)).toEqual([": Expected an integer"]);
    expect(messages({ type: "number" }, 1.5)).toEqual([]);
  });

  it("rejects NaN and Infinity, which JSON.parse never produces but code does", () => {
    expect(messages({ type: "number" }, Number.NaN)).toEqual([": Expected a finite number"]);
    expect(messages({ type: "number" }, Number.POSITIVE_INFINITY)).toEqual([
      ": Expected a finite number",
    ]);
  });

  it("bounds depth on the untrusted value", () => {
    // A schema that permits recursion must not let a value recurse forever.
    const nested: ValueSchema = { type: "object", properties: {} };
    (nested as { properties: Record<string, ValueSchema> }).properties.child = nested;
    let value: Record<string, unknown> = {};
    let cursor = value;
    for (let i = 0; i < 40; i++) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }
    const result = messages(nested, value);
    expect(result.some((m) => /nests deeper than/.test(m))).toBe(true);
  });

  it("bounds total node count", () => {
    const schema: ValueSchema = { type: "array", items: { type: "number" } };
    const huge = Array.from({ length: 2000 }, (_, i) => i);
    const result = messages(schema, huge);
    expect(result.some((m) => /more than \d+ nodes/.test(m))).toBe(true);
  });

  it("bounds string length independently of the schema", () => {
    expect(messages({ type: "string" }, "x".repeat(99_999))).toEqual([
      ": String exceeds 4096 characters",
    ]);
  });
});

describe("nested writes through the authority", () => {
  function authority() {
    return new LocalAuthority({
      storage: new MemoryStorage(createDemoDocument()),
      policy: DEMO_POLICY,
    });
  }

  it("commits a valid nested filter criterion", async () => {
    const result = await authority().commit(
      transaction("cmd_nested", 0, [
        {
          op: "state.set",
          path: "/filters/criteria",
          value: [{ dimension: "service", operator: "in", values: ["compute", "storage"] }],
        },
      ]),
      DEMO_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.document.shared.filters as { criteria: unknown[] }).criteria).toHaveLength(1);
  });

  it("rejects a nested value and points at the offending field", async () => {
    const result = await authority().commit(
      transaction("cmd_bad_nested", 0, [
        {
          op: "state.set",
          path: "/filters/criteria",
          value: [{ dimension: "service", operator: "in", values: ["ok"] }, { dimension: "region", operator: "in", values: [] }],
        },
      ]),
      DEMO_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
    // The path locates the bad field inside the submitted value.
    expect(result.error.path).toBe("/operations/0/value/1/dimension");
  });

  it("still rejects an unregistered path regardless of how well-formed the value is", async () => {
    const result = await authority().commit(
      transaction("cmd_unreg", 0, [
        { op: "state.set", path: "/filters/somethingElse", value: "plausible" },
      ]),
      DEMO_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/not a registered writable path/);
  });
});
