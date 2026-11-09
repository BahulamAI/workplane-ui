import { describe, expect, it } from "vitest";
import {
  compareHistories,
  computeCommitId,
  LocalAuthority,
  MemoryStorage,
  shortCommitId,
  verifyHistory,
  type CommittedEvent,
} from "@bahulam/workplane-ui";
import { createDemoDocument, DEMO_AGENT, DEMO_POLICY, DEMO_USER, transaction } from "@bahulam/workplane-ui/testkit";

function authority(now = () => "2026-09-24T12:00:00.000Z") {
  const storage = new MemoryStorage(createDemoDocument());
  return { storage, authority: new LocalAuthority({ storage, policy: DEMO_POLICY, now }) };
}

const setEnv = (value: string) => [{ op: "state.set" as const, path: "/filters/environment", value }];

describe("content-addressed commits", () => {
  it("is deterministic for identical inputs", async () => {
    const input = {
      parentId: null,
      documentId: "wp",
      revision: 1,
      operations: setEnv("all"),
      actorId: "u",
      committedAt: "2026-09-24T12:00:00.000Z",
    };
    expect(await computeCommitId(input)).toBe(await computeCommitId(input));
  });

  it("changes when ANY input changes", async () => {
    const base = {
      parentId: null, documentId: "wp", revision: 1,
      operations: setEnv("all"), actorId: "u", committedAt: "2026-09-24T12:00:00.000Z",
    };
    const id = await computeCommitId(base);
    const variants = [
      { ...base, parentId: "wpc_other" },
      { ...base, documentId: "wp2" },
      { ...base, revision: 2 },
      { ...base, operations: setEnv("development") },
      { ...base, actorId: "someone-else" },
      { ...base, committedAt: "2026-09-24T12:00:01.000Z" },
    ];
    for (const variant of variants) {
      expect(await computeCommitId(variant)).not.toBe(id);
    }
  });

  it("is insensitive to key order, so serialization cannot change identity", async () => {
    const a = { op: "block.update" as const, blockId: "b", patch: { title: "T", fallback: "F" } };
    const b = { op: "block.update" as const, blockId: "b", patch: { fallback: "F", title: "T" } };
    const base = { parentId: null, documentId: "wp", revision: 1, actorId: "u", committedAt: "t" };
    expect(await computeCommitId({ ...base, operations: [a] }))
      .toBe(await computeCommitId({ ...base, operations: [b] }));
  });

  it("abbreviates for display without losing identity", async () => {
    const id = await computeCommitId({
      parentId: null, documentId: "wp", revision: 1, operations: setEnv("all"), actorId: "u", committedAt: "t",
    });
    expect(id).toMatch(/^wpc_[0-9a-f]{64}$/);
    expect(shortCommitId(id)).toHaveLength(12);
  });
});

describe("the authority chains every commit", () => {
  it("links each commit to its predecessor", async () => {
    const { authority: gateway } = authority();
    const a = await gateway.commit(transaction("c1", 0, setEnv("development")), DEMO_USER);
    const b = await gateway.commit(transaction("c2", 1, setEnv("all")), DEMO_AGENT);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.event.parentId).toBeNull();
    expect(a.event.commitId).toMatch(/^wpc_/);
    expect(b.event.parentId).toBe(a.event.commitId);
  });

  it("verifies a sound history", async () => {
    const { authority: gateway } = authority();
    for (const [i, value] of ["development", "all", "production"].entries()) {
      await gateway.commit(transaction(`c${i}`, i, setEnv(value)), DEMO_USER);
    }
    const history = await gateway.eventsAfter("wp_azure_demo", 0);
    const verdict = verifyHistory(history);
    expect(verdict.status).toBe("verified");
    if (verdict.status !== "verified") return;
    expect(verdict.length).toBe(3);
  });

  it("detects a tampered link", async () => {
    const { authority: gateway } = authority();
    await gateway.commit(transaction("c1", 0, setEnv("development")), DEMO_USER);
    await gateway.commit(transaction("c2", 1, setEnv("all")), DEMO_USER);
    const history = await gateway.eventsAfter("wp_azure_demo", 0);

    const tampered = [history[0]!, { ...history[1]!, parentId: "wpc_forged" }];
    const verdict = verifyHistory(tampered);
    expect(verdict.status).toBe("broken");
    if (verdict.status !== "broken") return;
    expect(verdict.atRevision).toBe(2);
  });

  it("reports pre-chain events as unverifiable, not as broken", async () => {
    // "I cannot check this" and "this is wrong" must not look the same.
    const legacy: CommittedEvent[] = [{
      documentId: "wp", revision: 1, commandId: "old", operations: [],
      actor: { id: "u", type: "user" }, committedAt: "2026-01-01T00:00:00.000Z",
    }];
    const verdict = verifyHistory(legacy);
    expect(verdict.status).toBe("unverifiable");
    if (verdict.status !== "unverifiable") return;
    expect(verdict.reason).toMatch(/predates/);
  });

  it("reports a gap as unverifiable", async () => {
    const { authority: gateway } = authority();
    await gateway.commit(transaction("c1", 0, setEnv("development")), DEMO_USER);
    await gateway.commit(transaction("c2", 1, setEnv("all")), DEMO_USER);
    const history = await gateway.eventsAfter("wp_azure_demo", 0);
    const verdict = verifyHistory([history[0]!, { ...history[1]!, revision: 5 }]);
    expect(verdict.status).toBe("unverifiable");
  });
});

describe("divergence between two writers", () => {
  it("sees two histories that agree", async () => {
    const { authority: gateway } = authority();
    await gateway.commit(transaction("c1", 0, setEnv("development")), DEMO_USER);
    const history = await gateway.eventsAfter("wp_azure_demo", 0);
    const report = compareHistories(history, history);
    expect(report.diverged).toBe(false);
    expect(report.commonAncestorRevision).toBe(1);
  });

  it("detects two writers who both produced revision 2", async () => {
    // The case revision numbers CANNOT catch: both sides say "revision 2" and
    // the numbers agree while the content does not.
    const shared = authority();
    await shared.authority.commit(transaction("c1", 0, setEnv("development")), DEMO_USER);
    const base = await shared.authority.eventsAfter("wp_azure_demo", 0);

    const mine = await shared.authority.commit(transaction("c2", 1, setEnv("all")), DEMO_USER);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    // A second writer, from the same base, commits something else as revision 2.
    const other = authority(() => "2026-09-24T13:00:00.000Z");
    await other.authority.commit(transaction("c1", 0, setEnv("development")), DEMO_USER);
    const theirs = await other.authority.commit(transaction("c9", 1, setEnv("production")), DEMO_AGENT);
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) return;

    expect(mine.revision).toBe(theirs.revision); // both call themselves revision 2
    expect(mine.event.commitId).not.toBe(theirs.event.commitId); // but they are not the same commit

    const report = compareHistories([...base, mine.event], [...base, theirs.event]);
    expect(report.diverged).toBe(true);
    expect(report.commonAncestorRevision).toBe(1);
    expect(report.localOnly).toHaveLength(1);
    expect(report.remoteOnly).toHaveLength(1);
  });

  it("reports a fast-forward as not diverged", async () => {
    const { authority: gateway } = authority();
    await gateway.commit(transaction("c1", 0, setEnv("development")), DEMO_USER);
    const behind = await gateway.eventsAfter("wp_azure_demo", 0);
    await gateway.commit(transaction("c2", 1, setEnv("all")), DEMO_USER);
    const ahead = await gateway.eventsAfter("wp_azure_demo", 0);

    const report = compareHistories(behind, ahead);
    expect(report.diverged).toBe(false);
    expect(report.remoteOnly).toHaveLength(1);
    expect(report.localOnly).toHaveLength(0);
  });
});
