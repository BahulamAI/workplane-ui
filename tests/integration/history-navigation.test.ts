/**
 * History navigation — PRD section 5.4.6.
 *
 * The behaviour under test is mostly refusal. A historical document looks
 * identical to a live one, so the danger is not that navigation fails; it is
 * that it appears to work while a commit lands on live, a query re-runs against
 * the past, or a render job fires from a record. Section 5.4's own acceptance
 * case says it plainly: opening a past revision changes the preview only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDocument, diffDocuments, documentAt, LocalAuthority, MemoryStorage, WorkplaneController,
  type Actor, type Checkpoint, type HistoryPort, type Operation, type RevisionView,
  type WorkplaneDocument,
} from "@bahulam/workplane-ui";

const actor: Actor = { id: "u1", type: "user", capabilities: ["workplane.edit"] };

/**
 * A faithful fake: exactly what a host does — keep checkpoints, replay events
 * forward, and refuse rather than guess. Nothing here is a shortcut the real
 * host does not take.
 */
function historyPortOver(
  gateway: LocalAuthority,
  checkpoints: Checkpoint[],
): HistoryPort & { checkpoints: Checkpoint[] } {
  return {
    checkpoints,
    async entries(documentId, options) {
      const events = await gateway.eventsAfter(documentId, 0);
      const ordered = [...events].sort((a, b) => b.revision - a.revision);
      return {
        entries: (options?.limit ? ordered.slice(0, options.limit) : ordered).map((event) => ({
          revision: event.revision,
          ...(event.commitId ? { commitId: event.commitId } : {}),
          ...(event.parentId ? { parentId: event.parentId } : {}),
          actor: event.actor,
          committedAt: event.committedAt,
          operations: event.operations.map((op) => op.op),
        })),
        historyComplete: true,
        checkpoints: checkpoints.map((c) => c.revision),
      };
    },
    async at(documentId, revision): Promise<RevisionView> {
      const events = await gateway.eventsAfter(documentId, 0);
      const rebuilt = documentAt(revision, checkpoints, events);
      if (!rebuilt.ok) return rebuilt;
      const current = await gateway.snapshot(documentId);
      return {
        ok: true,
        document: rebuilt.document,
        diff: current ? diffDocuments(rebuilt.document, current) : null,
      };
    },
  };
}

const SCENE = (id: string, title: string): Operation => ({
  op: "scene.add",
  scene: { id, title, layout: "flow" },
});

interface Harness {
  controller: WorkplaneController;
  gateway: LocalAuthority;
  history: ReturnType<typeof historyPortOver>;
  queriesRun: number;
  actionsRequested: string[];
}

async function harness(): Promise<Harness> {
  const seed: WorkplaneDocument = {
    ...createDocument({ id: "wp_hist", title: "History document" }),
    shared: { assumption: 20 },
  };
  const gateway = new LocalAuthority({
    storage: new MemoryStorage(seed),
    policy: { writablePaths: [{ path: "/assumption", schema: { type: "integer" } }] },
  });
  // A checkpoint at the seed revision, which is what makes any of it reachable.
  const checkpoints: Checkpoint[] = [{ revision: seed.revision, document: seed }];
  const history = historyPortOver(gateway, checkpoints);

  const state = { queriesRun: 0, actionsRequested: [] as string[] };
  const controller = new WorkplaneController({
    gateway,
    documentId: seed.id,
    actor,
    history,
    debounceMs: 0,
    provider: {
      id: "counting",
      async execute() {
        state.queriesRun += 1;
        throw new Error("no data in this test");
      },
    },
    actions: {
      async request(request) {
        state.actionsRequested.push(request.actionId);
        return { status: "completed", result: null };
      },
      async listRegistered() {
        return [{ actionId: "recompute", summary: "Recompute" }];
      },
    },
  });
  await controller.load();
  return Object.assign(state, { controller, gateway, history }) as unknown as Harness;
}

describe("opening a past revision", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await h.controller.commit([SCENE("overview", "Overview")]);
    await h.controller.commit([SCENE("detail", "Detail")]);
    await h.controller.commit([{ op: "state.set", path: "/assumption", value: 30 }]);
  });

  it("shows the document as it stood, not as it is", async () => {
    const live = h.controller.revision;
    const view = await h.controller.enterHistory(live - 2);
    expect(view.ok, view.ok ? "" : view.message).toBe(true);

    const shown = h.controller.getState().document!;
    expect(shown.sceneOrder).toEqual(["overview"]);
    expect(shown.shared.assumption).toBe(20);
    // The head is untouched: previewing is not a mutation.
    expect(h.controller.document!.sceneOrder).toEqual(["overview", "detail"]);
    expect(h.controller.document!.shared.assumption).toBe(30);
  });

  it("says which revision this is and where live has got to", async () => {
    const live = h.controller.revision;
    await h.controller.enterHistory(live - 1);
    expect(h.controller.getState().preview).toEqual(
      expect.objectContaining({ revision: live - 1, liveRevision: live }),
    );
  });

  it("marks the navigation domain, so scenes and revisions never blur together", async () => {
    await h.controller.enterHistory(h.controller.revision - 1);
    const view = h.controller.session.getViewState();
    expect(view.navigationDomain).toBe("history");
    expect(view.historyRevision).toBe(h.controller.revision - 1);

    h.controller.returnToLive();
    expect(h.controller.session.getViewState().navigationDomain).toBe("scenes");
    expect(h.controller.session.getViewState().historyRevision).toBeNull();
  });

  it("treats asking for the current revision as returning to live", async () => {
    await h.controller.enterHistory(h.controller.revision - 1);
    expect(h.controller.getState().preview).toBeDefined();
    await h.controller.enterHistory(h.controller.revision);
    // Not "a read-only preview of something identical" — that would leave the
    // document unwritable for no reason a reader could see.
    expect(h.controller.getState().preview).toBeUndefined();
  });
});

describe("a past revision is read-only, and the controller enforces it", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await h.controller.commit([SCENE("overview", "Overview")]);
    await h.controller.commit([{ op: "state.set", path: "/assumption", value: 30 }]);
    await h.controller.enterHistory(h.controller.revision - 1);
  });

  it("refuses a commit instead of applying it to live", async () => {
    const liveBefore = h.controller.document!.revision;
    const result = await h.controller.commit([SCENE("sneaked", "Sneaked in")]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
      // The message has to name the way out. "Forbidden" alone leaves a reader
      // with a document that silently will not accept edits.
      expect(result.error.message).toMatch(/return to the current revision/i);
      expect(result.error.retry).toBe("do-not-retry");
    }
    // The point: live did not move. Hiding the button would not have achieved
    // this, because a renderer's own form reaches the controller directly.
    expect(h.controller.document!.revision).toBe(liveBefore);
    expect(h.controller.document!.sceneOrder).not.toContain("sneaked");
  });

  it("refuses a commit that arrives through a renderer's own write path", async () => {
    // `setSharedValue` is what a form block calls on submit. It must be refused
    // by the same rule, not by a different one that could drift.
    const result = await h.controller.setSharedValue("/assumption", 99);
    expect(result.ok).toBe(false);
    expect(h.controller.document!.shared.assumption).toBe(30);
  });

  it("refuses an action, so no render job runs from a record", async () => {
    const outcome = await h.controller.requestAction({ actionId: "recompute", arguments: {} });
    expect(outcome).toEqual(
      expect.objectContaining({ status: "unsupported", reason: expect.stringMatching(/revision/i) }),
    );
    expect(h.actionsRequested, "the broker was reached from a historical view").toEqual([]);
  });

  it("runs no query while previewing", async () => {
    const before = h.queriesRun;
    await h.controller.enterHistory(1);
    // Re-evaluating live queries against a historical document produces a
    // mixture of two moments that looks like neither.
    expect(h.queriesRun).toBe(before);
  });

  it("becomes writable again on returning to live", async () => {
    h.controller.returnToLive();
    const result = await h.controller.commit([SCENE("after", "After")]);
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
  });
});

describe("live moving while someone reads the past", () => {
  it("does not yank the view, but does say live moved on", async () => {
    const h = await harness();
    await h.controller.commit([SCENE("overview", "Overview")]);
    await h.controller.commit([SCENE("detail", "Detail")]);
    const target = h.controller.revision - 1;
    await h.controller.enterHistory(target);

    // A second writer commits — the agent, or another tab.
    const other = new WorkplaneController({
      gateway: h.gateway, documentId: "wp_hist", actor, debounceMs: 0,
      provider: { id: "none", async execute() { throw new Error("none"); } },
    });
    await other.load();
    await other.commit([SCENE("agents", "From the agent")]);
    other.dispose();

    const state = h.controller.getState();
    // Still reading what they opened...
    expect(state.preview?.revision).toBe(target);
    expect(state.document!.sceneOrder).not.toContain("agents");
    // ...and told that the world moved.
    expect(state.preview!.liveRevision).toBeGreaterThan(target);
    h.controller.dispose();
  });
});

describe("reconstruction that cannot be trusted is refused, not approximated", () => {
  it("surfaces the host's typed refusal when history was compacted past the target", async () => {
    const h = await harness();
    await h.controller.commit([SCENE("overview", "Overview")]);
    await h.controller.commit([SCENE("detail", "Detail")]);
    // Compaction: the only checkpoint now starts after the revision we want.
    h.history.checkpoints.splice(0, h.history.checkpoints.length, {
      revision: h.controller.revision,
      document: h.controller.document!,
    });

    const view = await h.controller.enterHistory(1);
    expect(view.ok).toBe(false);
    if (!view.ok) {
      expect(view.reason).toBe("no-checkpoint");
      expect(view.message).toMatch(/compacted/i);
    }
    // And nothing was shown: a half-rebuilt document gets compared against live
    // data and the difference gets believed.
    expect(h.controller.getState().preview).toBeUndefined();
    expect(h.controller.getState().document).toBe(h.controller.document);
    h.controller.dispose();
  });

  it("says so plainly when the host serves no history at all", async () => {
    const seed = createDocument({ id: "wp_none", title: "No history" });
    const controller = new WorkplaneController({
      gateway: new LocalAuthority({ storage: new MemoryStorage(seed), policy: { writablePaths: [] } }),
      documentId: seed.id, actor, debounceMs: 0,
      provider: { id: "none", async execute() { throw new Error("none"); } },
    });
    await controller.load();

    expect(controller.historyAvailable).toBe(false);
    const listing = await controller.historyEntries();
    expect(listing).toEqual(expect.objectContaining({ unavailable: expect.stringMatching(/checkpoints/i) }));
    const view = await controller.enterHistory(1);
    expect(view.ok).toBe(false);
    // An absent capability is an explicit unsupported state, never a silent no-op.
    if (!view.ok) expect(view.reason).toBe("unavailable");
    controller.dispose();
  });
});

describe("restoring moves the document forward", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await h.controller.commit([SCENE("overview", "Overview")]);
    await h.controller.commit([SCENE("detail", "Detail")]);
    await h.controller.commit([{ op: "state.set", path: "/assumption", value: 30 }]);
  });

  it("describes what will happen before offering the control", async () => {
    await h.controller.enterHistory(h.controller.revision - 2);
    const planned = h.controller.planRestore()!;
    expect(planned.description.length).toBeGreaterThan(1);
    // Section 5.4.6: the caller must state what a restore cannot undo.
    expect(planned.description.join(" ")).toMatch(/does not rewrite history/i);
    expect(planned.description.join(" ")).toMatch(/outside the document/i);
  });

  it("restores as a NEW revision rather than rewriting history", async () => {
    const before = h.controller.revision;
    await h.controller.enterHistory(before - 2);
    const result = await h.controller.restorePreviewed();

    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    // Forward, never backward: the revision number grows and every earlier
    // commit is still in the log.
    expect(h.controller.revision).toBeGreaterThan(before);
    const events = await h.gateway.eventsAfter("wp_hist", 0);
    expect(events.map((e) => e.revision)).toContain(before);

    // And the content is the old state again.
    expect(h.controller.document!.sceneOrder).toEqual(["overview"]);
    expect(h.controller.document!.shared.assumption).toBe(20);
  });

  it("leaves history mode when it restores, since the document is live again", async () => {
    await h.controller.enterHistory(h.controller.revision - 2);
    await h.controller.restorePreviewed();
    expect(h.controller.getState().preview).toBeUndefined();
    expect(h.controller.session.getViewState().navigationDomain).toBe("scenes");
  });

  it("refuses to restore a revision identical to the current document", async () => {
    // Restore back to the start, then try to restore the same thing again.
    await h.controller.enterHistory(h.controller.revision - 2);
    await h.controller.restorePreviewed();
    const settled = h.controller.revision;

    await h.controller.enterHistory(settled - 1);
    const planned = h.controller.planRestore()!;
    if (planned.plan.structural.length + planned.plan.shared.length === 0) {
      const result = await h.controller.restorePreviewed();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/identical|nothing to restore/i);
    }
  });

  it("throws rather than guessing when nothing is being previewed", async () => {
    expect(h.controller.planRestore()).toBeUndefined();
    await expect(h.controller.restorePreviewed()).rejects.toThrow(/no revision is being previewed/i);
  });
});
