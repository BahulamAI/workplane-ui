import type { Actor, CommandGateway, WorkplaneDocument } from "@bahulam/workplane-core";
import { PROTOCOL_VERSION, type Operation, type Transaction } from "@bahulam/workplane-protocol";
import { DEMO_AGENT, DEMO_USER, DEMO_VIEWER } from "./actors.js";
import { DEMO_DOCUMENT_ID, OVERVIEW_OPERATIONS } from "./demo-document.js";

export interface ConformanceCheck {
  id: string;
  title: string;
  /** Which PRD requirement this check exists to enforce. */
  requirement: string;
  status: "pass" | "fail" | "skipped";
  detail?: string;
}

export interface ConformanceReport {
  subject: string;
  checks: ConformanceCheck[];
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Builds a fresh, empty document and a gateway in front of it.
 * Called once per check so no check can depend on another's leftovers.
 */
export type GatewayFactory = () => Promise<{
  gateway: CommandGateway;
  documentId: string;
  dispose?: () => Promise<void> | void;
}>;

function tx(
  documentId: string,
  commandId: string,
  expectedRevision: number,
  operations: readonly Operation[],
): Transaction {
  return {
    protocolVersion: PROTOCOL_VERSION,
    documentId,
    commandId,
    expectedRevision,
    operations: [...operations],
  };
}

interface Case {
  id: string;
  title: string;
  requirement: string;
  run: (ctx: { gateway: CommandGateway; documentId: string }) => Promise<void>;
}

class CheckFailure extends Error {}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

const SET_ENV = (value: string): Operation => ({
  op: "state.set",
  path: "/filters/environment",
  value,
});

const CASES: Case[] = [
  {
    id: "snapshot",
    title: "returns an authorized snapshot with a revision",
    requirement: "PRD 12.2 — GET /workplanes/:id",
    async run({ gateway, documentId }) {
      const document = await gateway.snapshot(documentId);
      expect(document, "snapshot() returned nothing for a known document");
      expect(document.id === documentId, "snapshot returned the wrong document id");
      expect(Number.isInteger(document.revision), "revision must be an integer");
    },
  },
  {
    id: "commit-increments-revision",
    title: "a committed transaction increments the revision exactly once",
    requirement: "PRD 9.3",
    async run({ gateway, documentId }) {
      const before = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const result = await gateway.commit(
        tx(documentId, "cf_commit_1", before.revision, [SET_ENV("development")]),
        DEMO_USER,
      );
      expect(result.ok, `commit failed: ${result.ok ? "" : result.error.code}`);
      expect(
        result.revision === before.revision + 1,
        `revision went ${before.revision} -> ${result.revision}, expected +1`,
      );
    },
  },
  {
    id: "commit-is-durable-before-broadcast",
    title: "a committed change is readable from a fresh snapshot",
    requirement: "PRD 9.1 — persist atomically, then broadcast",
    async run({ gateway, documentId }) {
      const before = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      await gateway.commit(
        tx(documentId, "cf_durable", before.revision, [SET_ENV("development")]),
        DEMO_USER,
      );
      const after = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const filters = after.shared.filters as { environment?: string } | undefined;
      expect(filters?.environment === "development", "committed value is not in the snapshot");
    },
  },
  {
    id: "stale-revision-conflicts",
    title: "a stale expectedRevision returns CONFLICT with the current revision",
    requirement: "PRD 9.3 — optimistic concurrency",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      await gateway.commit(tx(documentId, "cf_first", start.revision, [SET_ENV("development")]), DEMO_USER);
      const stale = await gateway.commit(
        tx(documentId, "cf_stale", start.revision, [SET_ENV("all")]),
        DEMO_AGENT,
      );
      expect(!stale.ok, "a stale revision was accepted");
      if (stale.ok) return;
      expect(stale.error.code === "CONFLICT", `expected CONFLICT, got ${stale.error.code}`);
      expect(
        stale.error.detail?.currentRevision === start.revision + 1,
        "CONFLICT did not report the current revision",
      );
      expect(stale.error.retry === "rebase-and-retry", "CONFLICT must advise rebase-and-retry");
    },
  },
  {
    id: "idempotent-replay",
    title: "the same command id and payload replays without reapplying",
    requirement: "PRD 9.3 / AC-04",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const transaction = tx(documentId, "cf_idem", start.revision, [SET_ENV("development")]);
      const first = await gateway.commit(transaction, DEMO_USER);
      const second = await gateway.commit(transaction, DEMO_USER);
      expect(first.ok && second.ok, "a replayed command was rejected");
      if (!first.ok || !second.ok) return;
      expect(first.revision === second.revision, "a replay produced a second revision");
      expect(second.replayed === true, "a replay was not reported as replayed");
      const after = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      expect(after.revision === start.revision + 1, "a replay advanced the document revision");
    },
  },
  {
    id: "idempotency-mismatch",
    title: "the same command id with a different payload is refused",
    requirement: "PRD 9.3 / AC-05",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      await gateway.commit(tx(documentId, "cf_reuse", start.revision, [SET_ENV("development")]), DEMO_USER);
      const mismatch = await gateway.commit(
        tx(documentId, "cf_reuse", start.revision + 1, [SET_ENV("all")]),
        DEMO_USER,
      );
      expect(!mismatch.ok, "a reused command id with a new payload was accepted");
      if (mismatch.ok) return;
      expect(
        mismatch.error.code === "IDEMPOTENCY_MISMATCH",
        `expected IDEMPOTENCY_MISMATCH, got ${mismatch.error.code}`,
      );
      const after = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      expect(after.revision === start.revision + 1, "a rejected command still mutated the document");
    },
  },
  {
    id: "atomic-transaction",
    title: "one invalid operation rejects the whole transaction",
    requirement: "PRD 9.1 / AC-07",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const result = await gateway.commit(
        tx(documentId, "cf_atomic", start.revision, [
          { op: "scene.add", scene: { id: "cf_good", title: "Good" } },
          {
            op: "block.add",
            sceneId: "cf_missing",
            block: {
              id: "cf_orphan",
              kind: "content.text",
              title: "Orphan",
              rendererId: "workplane.text",
              specVersion: "1",
              spec: {},
            },
          },
        ]),
        DEMO_USER,
      );
      expect(!result.ok, "a transaction with an invalid operation was committed");
      const after = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      expect(after.revision === start.revision, "a rejected transaction changed the revision");
      expect(after.scenes.cf_good === undefined, "a rejected transaction left a partial change");
    },
  },
  {
    id: "unregistered-path-forbidden",
    title: "writing an unregistered path is refused",
    requirement: "PRD 8.3 — typed, registered write paths",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const result = await gateway.commit(
        tx(documentId, "cf_unreg", start.revision, [
          { op: "state.set", path: "/secrets/apiKey", value: "hunter2" },
        ]),
        DEMO_USER,
      );
      expect(!result.ok, "an unregistered write path was accepted");
      if (result.ok) return;
      expect(result.error.code === "FORBIDDEN", `expected FORBIDDEN, got ${result.error.code}`);
    },
  },
  {
    id: "policy-parity",
    title: "an agent and a user face identical policy",
    requirement: "PRD 2 invariant 4 / AC-10",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const structural: Operation[] = [{ op: "scene.add", scene: { id: "cf_p", title: "P" } }];
      const asUser = await gateway.commit(tx(documentId, "cf_pu", start.revision, structural), DEMO_VIEWER);
      const asAgent = await gateway.commit(
        tx(documentId, "cf_pa", start.revision, structural),
        { ...DEMO_VIEWER, type: "agent" } as Actor,
      );
      expect(!asUser.ok && !asAgent.ok, "an under-privileged actor committed a structural change");
      if (asUser.ok || asAgent.ok) return;
      expect(
        asUser.error.code === asAgent.error.code,
        `user got ${asUser.error.code} but agent got ${asAgent.error.code} for the same operation`,
      );
    },
  },
  {
    id: "events-after-revision",
    title: "committed events are replayable after a known revision",
    requirement: "PRD 12.2 — bounded replay / AC-08",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      await gateway.commit(tx(documentId, "cf_e1", start.revision, [SET_ENV("development")]), DEMO_USER);
      await gateway.commit(tx(documentId, "cf_e2", start.revision + 1, [SET_ENV("all")]), DEMO_USER);
      const missed = await gateway.eventsAfter(documentId, start.revision);
      expect(missed.length === 2, `expected 2 replayed events, got ${missed.length}`);
      expect(
        missed[0]!.revision < missed[1]!.revision,
        "replayed events are not in ascending revision order",
      );
      const fromLater = await gateway.eventsAfter(documentId, start.revision + 1);
      expect(fromLater.length === 1, "eventsAfter did not honour the revision cursor");
    },
  },
  {
    id: "event-carries-actor",
    title: "a committed event records who acted",
    requirement: "PRD 8.1 — provenance from authority, not payload",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const result = await gateway.commit(
        tx(documentId, "cf_actor", start.revision, [SET_ENV("development")]),
        DEMO_AGENT,
      );
      expect(result.ok, "commit failed");
      if (!result.ok) return;
      expect(result.event.actor.id === DEMO_AGENT.id, "event did not record the acting actor");
      expect(result.event.actor.type === "agent", "event did not record the actor type");
      expect(result.event.commandId === "cf_actor", "event did not record the command id");
    },
  },
  {
    id: "structural-commit",
    title: "a multi-block structural transaction commits as one revision",
    requirement: "PRD 9.2 / AC-01",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const result = await gateway.commit(
        tx(documentId, "cf_struct", start.revision, OVERVIEW_OPERATIONS),
        DEMO_AGENT,
      );
      expect(result.ok, `structural commit failed: ${result.ok ? "" : result.error.message}`);
      if (!result.ok) return;
      expect(result.revision === start.revision + 1, "a multi-operation transaction made several revisions");
      expect(result.document.sceneOrder.includes("overview"), "the scene was not added");
      expect(
        result.document.scenes.overview?.blockOrder.length === 5,
        "not every block landed in the scene",
      );
    },
  },
  {
    id: "subscribe-broadcast",
    title: "subscribers receive committed events, and unsubscribe stops them",
    requirement: "PRD 9.1 — broadcast only after commit",
    async run({ gateway, documentId }) {
      const seen: number[] = [];
      const unsubscribe = gateway.subscribe((event) => seen.push(event.revision));
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      await gateway.commit(tx(documentId, "cf_sub1", start.revision, [SET_ENV("development")]), DEMO_USER);
      await new Promise((r) => setTimeout(r, 50));
      expect(seen.length >= 1, "a subscriber received no event for a committed change");
      unsubscribe();
      const count = seen.length;
      await gateway.commit(tx(documentId, "cf_sub2", start.revision + 1, [SET_ENV("all")]), DEMO_USER);
      await new Promise((r) => setTimeout(r, 50));
      expect(seen.length === count, "an unsubscribed listener still received events");
    },
  },
  {
    id: "rejects-unknown-protocol",
    title: "an unsupported protocol version is refused",
    requirement: "PRD 12.3 — UNSUPPORTED_VERSION",
    async run({ gateway, documentId }) {
      const start = (await gateway.snapshot(documentId)) as WorkplaneDocument;
      const bad = {
        ...tx(documentId, "cf_proto", start.revision, [SET_ENV("development")]),
        protocolVersion: "workplane/99",
      } as unknown as Transaction;
      const result = await gateway.commit(bad, DEMO_USER);
      expect(!result.ok, "an unknown protocol version was accepted");
      if (result.ok) return;
      expect(
        result.error.code === "UNSUPPORTED_VERSION",
        `expected UNSUPPORTED_VERSION, got ${result.error.code}`,
      );
    },
  },
];

/**
 * Run every gateway conformance check against an implementation.
 *
 * This is the contract that makes transport replaceable: an in-process
 * authority and one behind an HTTP boundary must be indistinguishable from
 * here. A transport that changes the meaning of a command fails this suite.
 *
 * Each check gets a FRESH gateway from the factory, so ordering and leftover
 * state cannot mask a defect.
 */
export async function runGatewayConformance(
  subject: string,
  factory: GatewayFactory,
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];

  for (const testCase of CASES) {
    const harness = await factory();
    try {
      await testCase.run({ gateway: harness.gateway, documentId: harness.documentId });
      checks.push({
        id: testCase.id,
        title: testCase.title,
        requirement: testCase.requirement,
        status: "pass",
      });
    } catch (error) {
      checks.push({
        id: testCase.id,
        title: testCase.title,
        requirement: testCase.requirement,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await harness.dispose?.();
    }
  }

  return {
    subject,
    checks,
    passed: checks.filter((c) => c.status === "pass").length,
    failed: checks.filter((c) => c.status === "fail").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };
}

export { DEMO_DOCUMENT_ID };
