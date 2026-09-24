import { beforeEach, describe, expect, it } from "vitest";
import {
  LocalAuthority,
  MemoryStorage,
  type CommitResult,
  type Transaction,
} from "@bahulam/workplane-ui";
import {
  createDemoDocument,
  DEMO_AGENT,
  DEMO_POLICY,
  DEMO_USER,
  DEMO_VIEWER,
  OVERVIEW_OPERATIONS,
  transaction,
} from "@bahulam/workplane-ui/testkit";

function harness() {
  const storage = new MemoryStorage(createDemoDocument());
  const authority = new LocalAuthority({
    storage,
    policy: DEMO_POLICY,
    now: () => "2026-09-22T00:00:00.000Z",
  });
  return { storage, authority };
}

function expectOk(result: CommitResult) {
  if (!result.ok) throw new Error(`Expected commit to succeed, got ${result.error.code}: ${result.error.message}`);
  return result;
}

describe("AC-01 — an agent appends the overview scene", () => {
  it("commits every block in one revision", async () => {
    const { authority } = harness();
    const result = expectOk(
      await authority.commit(transaction("cmd_overview", 0, OVERVIEW_OPERATIONS), DEMO_AGENT),
    );
    expect(result.revision).toBe(1);
    expect(result.document.sceneOrder).toEqual(["overview"]);
    expect(result.document.scenes.overview?.blockOrder).toEqual([
      "filters",
      "total_spend_metric",
      "service_costs",
      "spend_trend_chart",
      "cost_table",
    ]);
    expect(result.event.actor).toMatchObject({ id: "agent_cost_analyst", type: "agent" });
  });
});

describe("AC-04 — the same command delivered twice", () => {
  it("increments the revision once and replays the prior result", async () => {
    const { authority } = harness();
    const tx = transaction("cmd_dup", 0, [
      { op: "state.set", path: "/filters/environment", value: "development" },
    ]);
    const first = expectOk(await authority.commit(tx, DEMO_USER));
    const second = expectOk(await authority.commit(tx, DEMO_USER));

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);

    const snapshot = await authority.snapshot("wp_azure_demo");
    expect(snapshot?.revision).toBe(1);
  });
});

describe("AC-05 — the same command id with a different payload", () => {
  it("returns IDEMPOTENCY_MISMATCH and mutates nothing", async () => {
    const { authority } = harness();
    await authority.commit(
      transaction("cmd_same", 0, [{ op: "state.set", path: "/filters/environment", value: "development" }]),
      DEMO_USER,
    );
    const result = await authority.commit(
      transaction("cmd_same", 1, [{ op: "state.set", path: "/filters/environment", value: "all" }]),
      DEMO_USER,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(result.error.retry).toBe("do-not-retry");

    const snapshot = await authority.snapshot("wp_azure_demo");
    expect(snapshot?.revision).toBe(1);
    expect((snapshot?.shared.filters as { environment: string }).environment).toBe("development");
  });
});

describe("AC-07 — one invalid operation in an otherwise valid transaction", () => {
  it("rejects the whole transaction with no partial durable change", async () => {
    const { authority } = harness();
    const result = await authority.commit(
      transaction("cmd_partial", 0, [
        { op: "scene.add", scene: { id: "good", title: "Good" } },
        { op: "block.add", sceneId: "does_not_exist", block: {
          id: "orphan", kind: "content.text", title: "Orphan",
          rendererId: "workplane.text", specVersion: "1", spec: {},
        } },
      ]),
      DEMO_USER,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.path).toBe("/operations/1/sceneId");

    const snapshot = await authority.snapshot("wp_azure_demo");
    expect(snapshot?.revision).toBe(0);
    expect(snapshot?.scenes.good).toBeUndefined();
  });
});

describe("optimistic concurrency", () => {
  it("returns CONFLICT with the current revision, not a silent merge", async () => {
    const { authority } = harness();
    await authority.commit(
      transaction("cmd_1", 0, [{ op: "state.set", path: "/filters/period", value: "2026-07" }]),
      DEMO_USER,
    );
    const stale = await authority.commit(
      transaction("cmd_2", 0, [{ op: "state.set", path: "/filters/period", value: "2026-08" }]),
      DEMO_AGENT,
    );

    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("CONFLICT");
    expect(stale.error.retry).toBe("rebase-and-retry");
    expect(stale.error.detail).toMatchObject({ currentRevision: 1, expectedRevision: 0 });
  });

  it("serializes concurrent commits so two writers cannot share a revision", async () => {
    const { authority } = harness();
    const [a, b] = await Promise.all([
      authority.commit(
        transaction("cmd_a", 0, [{ op: "state.set", path: "/filters/period", value: "2026-07" }]),
        DEMO_USER,
      ),
      authority.commit(
        transaction("cmd_b", 0, [{ op: "state.set", path: "/filters/environment", value: "all" }]),
        DEMO_AGENT,
      ),
    ]);
    // One wins, one is told to rebase. Neither is silently dropped.
    const outcomes = [a, b].map((r) => (r.ok ? "ok" : r.error.code)).sort();
    expect(outcomes).toEqual(["CONFLICT", "ok"]);
  });
});

describe("policy — the same gate for a user and an agent", () => {
  let authority: LocalAuthority;
  beforeEach(() => {
    authority = harness().authority;
  });

  it("rejects an unregistered write path", async () => {
    const result = await authority.commit(
      transaction("cmd_x", 0, [{ op: "state.set", path: "/secrets/apiKey", value: "hunter2" }]),
      DEMO_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
    expect(result.error.message).toMatch(/not a registered writable path/);
  });

  it("enforces the declared type", async () => {
    const result = await authority.commit(
      transaction("cmd_x", 0, [{ op: "state.set", path: "/assumptions/reductionPercent", value: "thirty" }]),
      DEMO_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("enforces the declared bounds", async () => {
    const result = await authority.commit(
      transaction("cmd_x", 0, [{ op: "state.set", path: "/assumptions/reductionPercent", value: 250 }]),
      DEMO_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/above the maximum/);
  });

  it("enforces the closed option set", async () => {
    const result = await authority.commit(
      transaction("cmd_x", 0, [{ op: "state.set", path: "/filters/period", value: "2099-01" }]),
      DEMO_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/not one of the permitted options/);
  });

  it("applies structural capability checks identically to an agent and a user", async () => {
    const op: Transaction["operations"] = [{ op: "scene.add", scene: { id: "s", title: "S" } }];
    for (const actor of [DEMO_VIEWER, { ...DEMO_VIEWER, type: "agent" as const }]) {
      const result = await authority.commit(transaction(`cmd_${actor.type}`, 0, op), actor);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.error.message).toMatch(/requires capability "workplane.edit"/);
    }
  });

  it("ignores capabilities asserted in the transaction body", async () => {
    // A body field claiming authority is not authority: the actor is supplied
    // out of band, so there is nowhere in the envelope to put a forged claim.
    const forged = {
      ...transaction("cmd_forge", 0, [{ op: "scene.add" as const, scene: { id: "s", title: "S" } }]),
      actor: { id: "root", type: "user", capabilities: ["workplane.edit"] },
    } as Transaction;
    const result = await authority.commit(forged, DEMO_VIEWER);
    expect(result.ok).toBe(false);
  });
});

describe("AC-08 — reconnect", () => {
  it("replays committed events after a known revision", async () => {
    const { authority } = harness();
    await authority.commit(transaction("c1", 0, OVERVIEW_OPERATIONS), DEMO_AGENT);
    await authority.commit(
      transaction("c2", 1, [{ op: "state.set", path: "/filters/period", value: "2026-07" }]),
      DEMO_USER,
    );
    const missed = await authority.eventsAfter("wp_azure_demo", 1);
    expect(missed.map((e) => e.revision)).toEqual([2]);
    expect(missed[0]?.commandId).toBe("c2");
  });

  it("broadcasts only after the commit is durable", async () => {
    const { authority, storage } = harness();
    const seen: number[] = [];
    authority.subscribe(async (event) => {
      const persisted = await storage.load("wp_azure_demo");
      // The listener must never observe a revision that is not yet stored.
      expect(persisted?.revision).toBe(event.revision);
      seen.push(event.revision);
    });
    await authority.commit(transaction("c1", 0, OVERVIEW_OPERATIONS), DEMO_AGENT);
    expect(seen).toEqual([1]);
  });
});

describe("limits", () => {
  it("rejects an oversized transaction rather than accepting it slowly", async () => {
    const { authority } = harness();
    const operations = Array.from({ length: 100 }, (_, i) => ({
      op: "scene.add" as const,
      scene: { id: `s${i}`, title: `S${i}` },
    }));
    const result = await authority.commit(transaction("cmd_big", 0, operations), DEMO_USER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RESOURCE_LIMIT");
  });
});

describe("a block must be renderable", () => {
  /**
   * An agent sent widget-shaped blocks to block.add — {id, type, title, value,
   * data} instead of {id, kind, title, rendererId, specVersion, spec}. The
   * unrecognised fields became undefined and the document accepted three blocks
   * with no renderer, which nothing could ever display.
   */
  const widgetShaped = {
    id: "metric-summary",
    type: "metric",
    title: "Projection Summary (INR)",
    value: "₹3,000/day",
    data: [{ label: "Run Rate", value: "₹3,000/day" }],
  } as never;

  it("rejects a block with no rendererId", async () => {
    const { authority } = harness();
    const result = await authority.commit(
      transaction("cmd_no_renderer", 0, [
        { op: "scene.add", scene: { id: "p", title: "P" } },
        { op: "block.add", sceneId: "p", block: widgetShaped },
      ]),
      DEMO_AGENT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
    // Every missing field is reported at once, so an agent repairs in one pass
    // rather than one round trip per field.
    const all = String(result.error.detail?.all ?? "");
    // fallback is not listed: the reducer defaults it to the block title, which
    // is a reasonable default. The other four cannot be guessed.
    for (const field of ["kind", "rendererId", "specVersion", "spec"]) {
      expect(all, `${field} not reported`).toContain(`/blocks/metric-summary/${field}`);
    }
    expect(all).toMatch(/namespaced "rendererId"/);
  });

  it("leaves nothing behind when it rejects", async () => {
    const { authority } = harness();
    await authority.commit(
      transaction("cmd_x", 0, [
        { op: "scene.add", scene: { id: "p", title: "P" } },
        { op: "block.add", sceneId: "p", block: widgetShaped },
      ]),
      DEMO_AGENT,
    );
    const snapshot = await authority.snapshot("wp_azure_demo");
    expect(snapshot?.revision).toBe(0);
    expect(snapshot?.scenes.p).toBeUndefined();
  });

  it("names every required field that is missing", async () => {
    const { authority } = harness();
    for (const [field, block] of [
      ["specVersion", { id: "b", kind: "k", title: "T", rendererId: "workplane.text", spec: {} }],
      ["spec", { id: "b", kind: "k", title: "T", rendererId: "workplane.text", specVersion: "1" }],
      ["kind", { id: "b", title: "T", rendererId: "workplane.text", specVersion: "1", spec: {} }],
    ] as const) {
      const result = await authority.commit(
        transaction(`cmd_${field}`, 0, [
          { op: "scene.add", scene: { id: "s", title: "S" } },
          { op: "block.add", sceneId: "s", block: block as never },
        ]),
        DEMO_AGENT,
      );
      expect(result.ok, `${field} was accepted`).toBe(false);
      if (result.ok) continue;
      expect(result.error.path).toContain(field);
    }
  });

  it("does not freeze a document that is ALREADY damaged", async () => {
    // Without this, a document containing one bad block could never be edited
    // again — including by the transaction that would remove the bad block.
    const damaged = createDemoDocument();
    damaged.sceneOrder = ["broken"];
    damaged.scenes.broken = { id: "broken", title: "Broken", layout: "flow", blockOrder: ["bad"], parameters: {} };
    damaged.blocks.bad = { id: "bad", kind: "", title: "Bad", rendererId: "", specVersion: "", spec: {}, bindings: {}, dataRefs: [], fallback: "" } as never;

    const authority = new LocalAuthority({ storage: new MemoryStorage(damaged), policy: DEMO_POLICY });

    // A valid edit elsewhere still works.
    const edit = await authority.commit(
      transaction("cmd_ok", 0, [{ op: "state.set", path: "/filters/period", value: "2026-07" }]),
      DEMO_USER,
    );
    expect(edit.ok, "a pre-existing defect froze the whole document").toBe(true);

    // And the repair itself is permitted.
    const repair = await authority.commit(
      transaction("cmd_repair", 1, [{ op: "block.remove", blockId: "bad" }]),
      DEMO_USER,
    );
    expect(repair.ok).toBe(true);
    if (!repair.ok) return;
    expect(repair.document.blocks.bad).toBeUndefined();

    // But NEW damage is still refused.
    const more = await authority.commit(
      transaction("cmd_more", 2, [
        { op: "block.add", sceneId: "broken", block: widgetShaped },
      ]),
      DEMO_AGENT,
    );
    expect(more.ok).toBe(false);
  });
});
