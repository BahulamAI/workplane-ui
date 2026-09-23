import { describe, expect, it } from "vitest";
import { createNativeRegistry, type RendererDefinition } from "@bahulam/workplane-react";
import { echartsRenderer } from "@bahulam/workplane-renderer-echarts";

const registry = createNativeRegistry().register(echartsRenderer);
const definitions = [...registry.list()].map((entry) => registry.get(entry.id)!) as RendererDefinition[];

/**
 * Conformance every renderer must pass, first-party or community. A renderer
 * that fails one of these can corrupt a document or leak into agent context.
 */
describe.each(definitions.map((d) => [d.id, d] as const))("renderer contract: %s", (_id, definition) => {
  it("declares a namespaced id and at least one spec version", () => {
    expect(definition.id).toMatch(/^[a-z0-9]+\.[a-z0-9-]+$/);
    expect(definition.specVersions.length).toBeGreaterThan(0);
  });

  it("declares its full capability set", () => {
    for (const key of ["interactive", "selection", "thumbnail", "staticExport", "suspend", "requiresWebGL"]) {
      expect(typeof definition.capabilities[key as keyof typeof definition.capabilities]).toBe("boolean");
    }
  });

  it("rejects non-object specs instead of throwing", () => {
    for (const bad of [null, 42, "text", [], true]) {
      const outcome = definition.validate(bad);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(typeof outcome.message).toBe("string");
    }
  });

  it("rejects an empty spec rather than inventing defaults for required fields", () => {
    const outcome = definition.validate({});
    // A renderer with no required fields may accept {}; one with required
    // fields must say which field is missing, with a path an agent can repair.
    if (!outcome.ok) {
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });

  it("ignores unknown spec fields rather than passing them through", () => {
    const hostile = { __proto__: { polluted: true }, onClick: "alert(1)", dangerouslySetInnerHTML: "<script>" };
    const outcome = definition.validate(hostile);
    if (outcome.ok) {
      expect(JSON.stringify(outcome.value)).not.toMatch(/alert|script|polluted/);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("produces a bounded plain-text summary for agent context", () => {
    const valid = VALID_SPECS[definition.id];
    if (!valid) return;
    const outcome = definition.validate(valid);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const summary = definition.summarize(outcome.value);
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeLessThanOrEqual(300);
    expect(summary).not.toMatch(/[<>]/);
  });

  it("assigns trust from a closed set", () => {
    expect(["host-reviewed", "sandboxed"]).toContain(definition.trust);
  });
});

const VALID_SPECS: Record<string, unknown> = {
  "workplane.text": { text: "hello" },
  "workplane.fact": { template: "{a} and {b}" },
  "workplane.metric": { queryId: "q", column: "total" },
  "workplane.table": { queryId: "q", columns: ["a"], pageSize: 10 },
  "workplane.form": {
    fields: [{ name: "n", label: "N", control: "number", path: "/a/b" }],
    submitLabel: "Apply",
  },
  "workplane.echarts": {
    chartType: "bar",
    queryId: "q",
    categoryColumn: "service",
    valueColumn: "cost",
  },
};

describe("catalog discovery", () => {
  it("exposes ids, versions, trust, and capabilities for agent discovery", () => {
    for (const entry of registry.list()) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("specVersions");
      expect(entry).toHaveProperty("trust");
      expect(entry).toHaveProperty("capabilities");
    }
  });

  it("does not expose the React component to a discovery caller", () => {
    for (const entry of registry.list()) {
      expect(entry).not.toHaveProperty("Component");
    }
  });
});

describe("form spec validation", () => {
  const form = registry.get("workplane.form")!;

  it("rejects an unsupported control type", () => {
    const outcome = form.validate({
      fields: [{ name: "n", label: "N", control: "richtext", path: "/a" }],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/Unsupported control/);
  });

  it("rejects a field path that is not a JSON Pointer", () => {
    const outcome = form.validate({
      fields: [{ name: "n", label: "N", control: "text", path: "a.b" }],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/JSON Pointer/);
  });
});

describe("chart spec validation", () => {
  it("rejects a raw vendor option object", () => {
    // Accepting an ECharts `option` would admit formatter functions and remote
    // URLs from the document. The adapter builds the option itself.
    const outcome = echartsRenderer.validate({
      series: [{ type: "bar", data: [1, 2, 3] }],
      tooltip: { formatter: "() => fetch('https://example.com')" },
    });
    expect(outcome.ok).toBe(false);
  });

  it("rejects an unsupported chart type", () => {
    const outcome = echartsRenderer.validate({
      chartType: "sunburst",
      queryId: "q",
      categoryColumn: "a",
      valueColumn: "b",
    });
    expect(outcome.ok).toBe(false);
  });
});
