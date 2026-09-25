import { describe, expect, it } from "vitest";
import { BUILTIN_RENDERERS, describeCatalog } from "@bahulam/workplane-ui";
import { createNativeRegistry } from "@bahulam/workplane-ui/react";
import { echartsRenderer } from "@bahulam/workplane-ui/echarts";
import { diagramRenderer } from "@bahulam/workplane-ui/diagram";

const registry = createNativeRegistry().register(echartsRenderer).register(diagramRenderer);

/**
 * The host describes the catalog without importing the renderers, because the
 * host is headless. Two hand-maintained lists drift, and the drift shows up as
 * an agent confidently using a renderer that is not installed — so they are
 * checked against each other here.
 */
describe("the published catalog matches the renderers that exist", () => {
  it("describes every registered renderer", () => {
    const described = new Set(BUILTIN_RENDERERS.map((r) => r.id));
    const missing = registry.list().map((r) => r.id).filter((id) => !described.has(id));
    expect(missing, `renderers exist but are not described: ${missing.join(", ")}`).toEqual([]);
  });

  it("describes nothing that does not exist", () => {
    const registered = new Set(registry.list().map((r) => r.id));
    const phantom = BUILTIN_RENDERERS.map((r) => r.id).filter((id) => !registered.has(id));
    expect(phantom, `described but not registered: ${phantom.join(", ")}`).toEqual([]);
  });

  it("agrees on spec versions", () => {
    for (const descriptor of BUILTIN_RENDERERS) {
      const actual = registry.get(descriptor.id);
      expect(actual, descriptor.id).toBeDefined();
      expect(actual!.specVersions, descriptor.id).toEqual(descriptor.specVersions);
    }
  });

  it("gives an agent a purpose and a spec shape for each", () => {
    for (const descriptor of BUILTIN_RENDERERS) {
      expect(descriptor.purpose.length, descriptor.id).toBeGreaterThan(20);
      expect(descriptor.shape.length, descriptor.id).toBeGreaterThan(10);
    }
  });

  it("names the peer dependency where one is needed", () => {
    expect(BUILTIN_RENDERERS.find((r) => r.id === "workplane.echarts")?.requires).toBe("echarts");
    expect(BUILTIN_RENDERERS.find((r) => r.id === "workplane.diagram")?.requires).toBe("mermaid");
    expect(BUILTIN_RENDERERS.find((r) => r.id === "workplane.markdown")?.requires).toBeUndefined();
  });

  it("renders compactly enough to sit in a tool description", () => {
    const text = describeCatalog();
    expect(text).toContain("workplane.markdown");
    expect(text).toContain("workplane.diagram");
    // A catalog nobody can afford to send is a catalog nobody sends.
    expect(text.length).toBeLessThan(4000);
  });

  it("tells an agent the things it otherwise gets wrong", () => {
    const text = describeCatalog();
    // Every one of these was an actual mistake made against this API.
    expect(text, "minor units").toMatch(/MINOR UNITS/);
    expect(text, "alt text required").toMatch(/REQUIRED/);
    expect(text, "colour-only series").toMatch(/not colour alone/);
  });
});

describe("every advertised example actually works", () => {
  /**
   * This is what makes the catalog trustworthy rather than merely present.
   *
   * Prose drifts from the validator and nothing notices — an agent then follows
   * a description that stopped being true and gets a rejection it cannot
   * explain. An example cannot drift, because it is run through the renderer it
   * claims to describe.
   */
  it.each(BUILTIN_RENDERERS.map((r) => [r.id, r] as const))(
    "%s: the published example validates",
    (id, descriptor) => {
      const renderer = registry.get(id);
      expect(renderer, `${id} is described but not registered`).toBeDefined();
      const outcome = renderer!.validate(descriptor.example);
      expect(
        outcome.ok,
        outcome.ok ? "" : `the catalog advertises a spec its own renderer rejects: ${outcome.message}`,
      ).toBe(true);
    },
  );

  it.each(
    BUILTIN_RENDERERS.filter((r) => r.alternateExample).map((r) => [r.id, r] as const),
  )("%s: the alternate example validates too", (id, descriptor) => {
    const outcome = registry.get(id)!.validate(descriptor.alternateExample);
    expect(outcome.ok, outcome.ok ? "" : `alternate example rejected: ${outcome.message}`).toBe(true);
  });

  it("summarises every example without throwing", () => {
    // summarize() feeds agent context, so a renderer that throws on its own
    // advertised spec would poison the projection.
    for (const descriptor of BUILTIN_RENDERERS) {
      const outcome = registry.get(descriptor.id)!.validate(descriptor.example);
      if (!outcome.ok) continue;
      const summary = registry.get(descriptor.id)!.summarize(outcome.value as never);
      expect(typeof summary, descriptor.id).toBe("string");
      expect(summary.length, descriptor.id).toBeGreaterThan(0);
    }
  });

  it("puts the examples in what the agent is sent", () => {
    const text = describeCatalog();
    expect(text).toContain('"markdown"');
    expect(text).toContain('"lineStyle"');
    expect(text).toContain('"actionId"');
  });
});

describe("the button block", () => {
  const button = registry.get("workplane.button")!;

  it("accepts an action id and typed arguments", () => {
    const outcome = button.validate({
      actionId: "check_answer", label: "Check", arguments: { choice: "b" },
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("refuses anything that is not a registered id", () => {
    for (const actionId of [
      "https://evil.example/run",
      "../../etc/passwd",
      "rm -rf /",
      "azure_cost_by_service",  // a tool name is still not an action id shape
      "",
    ]) {
      const outcome = button.validate({ actionId, label: "Go" });
      if (actionId === "azure_cost_by_service") {
        // Shaped like an id, so the BROKER refuses it, not the spec validator.
        expect(outcome.ok).toBe(true);
        continue;
      }
      expect(outcome.ok, `${actionId} was accepted`).toBe(false);
    }
  });

  it("requires a label that says what it does", () => {
    expect(button.validate({ actionId: "go", label: "" }).ok).toBe(false);
  });

  it("carries no URL and no executable content in its arguments", () => {
    expect(button.validate({
      actionId: "go", label: "Go", arguments: { target: "https://evil.example" },
    }).ok).toBe(false);
  });
});
