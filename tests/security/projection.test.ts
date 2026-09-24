import { describe, expect, it } from "vitest";
import { applyOperations, projectForAgent } from "@bahulam/workplane-ui";
import { createDemoDocument, DEMO_POLICY, OVERVIEW_OPERATIONS } from "@bahulam/workplane-ui/testkit";

function populated() {
  return applyOperations(createDemoDocument(), [...OVERVIEW_OPERATIONS]);
}

describe("agent context projection", () => {
  it("shows the outline, revision, and committed state", () => {
    const context = projectForAgent(populated(), { policy: DEMO_POLICY });
    expect(context.revision).toBe(0);
    expect(context.scenes[0]?.id).toBe("overview");
    expect(context.scenes[0]?.blocks.map((b) => b.id)).toContain("service_costs");
    expect(context.state["/filters/period"]).toBe("2026-08");
    expect(context.state["/assumptions/reductionPercent"]).toBe(20);
  });

  it("tells the agent exactly what it may write", () => {
    const context = projectForAgent(populated(), { policy: DEMO_POLICY });
    expect(context.writablePaths.map((w) => w.path)).toContain("/assumptions/reductionPercent");
  });

  it("lets the agent observe a committed change", () => {
    const before = projectForAgent(populated(), { policy: DEMO_POLICY });
    const after = projectForAgent(
      applyOperations(populated(), [
        { op: "state.set", path: "/assumptions/reductionPercent", value: 30 },
      ]),
      { policy: DEMO_POLICY },
    );
    expect(before.state["/assumptions/reductionPercent"]).toBe(20);
    expect(after.state["/assumptions/reductionPercent"]).toBe(30);
  });
});

describe("what the projection must never carry", () => {
  it("carries no row data, only source identity and schema", () => {
    const context = projectForAgent(populated(), { policy: DEMO_POLICY });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/420000|rows/);
    expect(context.dataSources[0]).toMatchObject({
      id: "azure_costs",
      provider: "synthetic.azure-cost",
      sensitivity: "internal",
    });
  });

  it("does not expose an unregistered shared path", () => {
    // Something a host stashed in shared state that is not user-writable is
    // also not agent-visible: the projection is built FROM the policy.
    const document = applyOperations(createDemoDocument(), []);
    const withExtra = { ...document, shared: { ...document.shared, internalNote: "do not leak" } };
    const context = projectForAgent(withExtra, { policy: DEMO_POLICY });
    expect(JSON.stringify(context)).not.toMatch(/do not leak/);
  });

  it("has no channel for credentials, resolver URLs, or handles", () => {
    const context = projectForAgent(populated(), { policy: DEMO_POLICY });
    // The AgentContext type has no artifacts field at all — a signed URL has
    // nowhere to go even if a caller tried.
    expect(context).not.toHaveProperty("artifacts");
    expect(context).not.toHaveProperty("credentials");
    expect(JSON.stringify(context)).not.toMatch(/https?:\/\//);
  });

  it("truncates against the context budget instead of emitting broken JSON", () => {
    const changes = Array.from({ length: 200 }, (_, i) => ({
      revision: i, actor: "agent", summary: `change number ${i} with some descriptive padding text`,
    }));
    const context = projectForAgent(populated(), {
      policy: DEMO_POLICY,
      recentChanges: changes,
      maxCharacters: 2_000,
    });
    expect(context.truncated).toBe(true);
    expect(context.recentChanges.length).toBeLessThanOrEqual(3);
    expect(() => JSON.parse(JSON.stringify(context))).not.toThrow();
  });
});
