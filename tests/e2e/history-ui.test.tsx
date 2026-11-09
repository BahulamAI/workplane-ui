/**
 * The History UI — PRD section 5.4.6.
 *
 * One requirement drives most of this: scenes and revisions are different
 * sequences and must never appear as one unlabelled list. A control where
 * "next" sometimes means later in the argument and sometimes later in time is
 * one a reader cannot use correctly, however clearly each item is drawn.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDocument, diffDocuments, documentAt, LocalAuthority, MemoryStorage, WorkplaneController,
  type Actor, type Checkpoint, type HistoryPort, type Operation, type WorkplaneDocument,
} from "@bahulam/workplane-ui";
import {
  createNativeRegistry, createPresenterRegistry, HistoryPanel, Presenter, WorkplaneProvider,
} from "@bahulam/workplane-ui/react";

const actor: Actor = { id: "u1", type: "user", capabilities: ["workplane.edit"] };
const controllers: WorkplaneController[] = [];
afterEach(() => {
  cleanup();
  for (const c of controllers.splice(0)) c.dispose();
});

const scene = (id: string, title: string): Operation => ({
  op: "scene.add", scene: { id, title, layout: "flow" },
});

function block(id: string, sceneId: string, text: string): Operation {
  return {
    op: "block.add", sceneId,
    block: {
      id, kind: "text", title: `Block ${id}`, rendererId: "workplane.text",
      specVersion: "1", spec: { text }, bindings: {}, dataRefs: [], fallback: text,
    },
  };
}

async function mount(options?: { withHistory?: boolean; historyComplete?: boolean }) {
  const seed: WorkplaneDocument = {
    ...createDocument({ id: "wp_ui", title: "History UI" }),
    shared: { assumption: 20 },
  };
  const gateway = new LocalAuthority({
    storage: new MemoryStorage(seed),
    policy: { writablePaths: [{ path: "/assumption", schema: { type: "integer" } }] },
  });
  const checkpoints: Checkpoint[] = [{ revision: seed.revision, document: seed }];

  const history: HistoryPort = {
    async entries(documentId) {
      const events = await gateway.eventsAfter(documentId, 0);
      return {
        entries: [...events].sort((a, b) => b.revision - a.revision).map((event) => ({
          revision: event.revision,
          actor: event.actor,
          committedAt: event.committedAt,
          operations: event.operations.map((op) => op.op),
        })),
        historyComplete: options?.historyComplete !== false,
      };
    },
    async at(documentId, revision) {
      const events = await gateway.eventsAfter(documentId, 0);
      const rebuilt = documentAt(revision, checkpoints, events);
      if (!rebuilt.ok) return rebuilt;
      const current = await gateway.snapshot(documentId);
      return { ok: true, document: rebuilt.document, diff: current ? diffDocuments(rebuilt.document, current) : null };
    },
  };

  const controller = new WorkplaneController({
    gateway, documentId: seed.id, actor, debounceMs: 0,
    ...(options?.withHistory === false ? {} : { history }),
    provider: { id: "none", async execute() { throw new Error("no data in this test"); } },
  });
  controllers.push(controller);
  await controller.load();
  await controller.commit([scene("overview", "Overview"), block("b1", "overview", "First")]);
  await controller.commit([scene("detail", "Detail"), block("b2", "detail", "Second")]);
  await controller.commit([{ op: "state.set", path: "/assumption", value: 30 }]);

  render(
    <WorkplaneProvider controller={controller} renderers={createNativeRegistry()}>
      <HistoryPanel onDomainChange={() => {}} />
      <Presenter controller={controller} registry={createPresenterRegistry()} />
    </WorkplaneProvider>,
  );
  return controller;
}

describe("the two sequences stay separate", () => {
  it("offers an explicitly labelled switch, not one merged list", async () => {
    await mount();
    const tabs = screen.getByRole("tablist", { name: "Navigate by" });
    // The exact words section 5.4.6 requires.
    expect(within(tabs).getByRole("tab", { name: "Scenes" })).toBeDefined();
    expect(within(tabs).getByRole("tab", { name: "History" })).toBeDefined();
  });

  it("uses a tablist here and links for scenes, because only one of them switches panels", async () => {
    await mount();
    // Scene navigation moves within one document: links.
    const nav = screen.getByRole("navigation", { name: "Scenes" });
    expect(within(nav).getAllByRole("link").length).toBeGreaterThan(0);
    // Domain switching swaps what you are looking at: tabs.
    expect(screen.getByRole("tablist", { name: "Navigate by" })).toBeDefined();
  });

  it("lists revisions newest first, with who and what", async () => {
    await mount();
    await waitFor(() => {
      expect(globalThis.document.querySelectorAll('[data-workplane="history-entries"] li').length)
        .toBeGreaterThan(2);
    });
    const items = [...globalThis.document.querySelectorAll('[data-workplane="history-entries"] li')];
    const revisions = items.map((li) => Number(li.getAttribute("data-revision")));
    expect(revisions).toEqual([...revisions].sort((a, b) => b - a));
    // Each entry says what happened without showing payloads.
    expect(items[0]!.textContent).toMatch(/state\.set/);
    expect(items[0]!.textContent).toMatch(/u1/);
  });

  it("marks which revision is the current one", async () => {
    const controller = await mount();
    await waitFor(() => {
      const current = globalThis.document.querySelector(`li[data-revision="${controller.revision}"]`);
      expect(current?.getAttribute("data-current")).toBe("true");
      expect(current?.textContent).toMatch(/current/i);
    });
  });
});

describe("a reader is always told they are looking at the past", () => {
  it("shows a banner naming the revision and where live is", async () => {
    const user = userEvent.setup();
    const controller = await mount();
    const target = controller.revision - 2;
    await waitFor(() => expect(globalThis.document.querySelector(`li[data-revision="${target}"]`)).not.toBeNull());

    await user.click(within(globalThis.document.querySelector(`li[data-revision="${target}"]`)!).getByRole("button"));

    await screen.findByText(new RegExp(`Revision ${target}`));
    // The whole banner, not just the emphasised revision number inside it.
    const banner = globalThis.document.querySelector('[data-workplane="history-banner"]')!;
    expect(banner.textContent).toMatch(new RegExp(`Revision ${target}`));
    expect(banner.textContent).toMatch(/read-only/i);
    // Naming where live is, so "this looks out of date" has an explanation.
    expect(banner.textContent).toMatch(new RegExp(`current revision is ${controller.revision}`));
  });

  it("shows the historical content, not the current content", async () => {
    const user = userEvent.setup();
    const controller = await mount();
    const target = controller.revision - 2;
    await waitFor(() => expect(globalThis.document.querySelector(`li[data-revision="${target}"]`)).not.toBeNull());
    await user.click(within(globalThis.document.querySelector(`li[data-revision="${target}"]`)!).getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Overview" })).toBeDefined();
      // "Detail" arrived in a later revision and must not be on screen.
      expect(screen.queryByRole("heading", { name: "Detail" })).toBeNull();
    });
  });

  it("returns to live on request", async () => {
    const user = userEvent.setup();
    const controller = await mount();
    const target = controller.revision - 2;
    await waitFor(() => expect(globalThis.document.querySelector(`li[data-revision="${target}"]`)).not.toBeNull());
    await user.click(within(globalThis.document.querySelector(`li[data-revision="${target}"]`)!).getByRole("button"));

    await user.click(await screen.findByRole("button", { name: /return to current revision/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Detail" })).toBeDefined();
      expect(screen.queryByText(/read-only/i)).toBeNull();
    });
  });
});

describe("the restore control states its consequences first", () => {
  async function preview() {
    const user = userEvent.setup();
    const controller = await mount();
    const target = controller.revision - 2;
    await waitFor(() => expect(globalThis.document.querySelector(`li[data-revision="${target}"]`)).not.toBeNull());
    await user.click(within(globalThis.document.querySelector(`li[data-revision="${target}"]`)!).getByRole("button"));
    await screen.findByText(/read-only/i);
    return { user, controller, target };
  }

  it("does not restore on one click", async () => {
    const { user, controller } = await preview();
    const before = controller.revision;
    await user.click(screen.getByRole("button", { name: /restore this revision/i }));
    // The first click explains; it does not act.
    expect(controller.revision).toBe(before);
    expect(screen.getByRole("button", { name: /restore as a new revision/i })).toBeDefined();
  });

  it("says what will change and what a restore cannot undo", async () => {
    const { user } = await preview();
    await user.click(screen.getByRole("button", { name: /restore this revision/i }));
    const text = globalThis.document.querySelector('[data-workplane="history-restore-confirm"]')!.textContent!;
    expect(text).toMatch(/new revision/i);
    expect(text).toMatch(/does not rewrite history/i);
    // The honest limit: a restore cannot reach a job that already ran.
    expect(text).toMatch(/outside the document/i);
  });

  it("restores forward and lands back on live", async () => {
    const { user, controller } = await preview();
    const before = controller.revision;
    await user.click(screen.getByRole("button", { name: /restore this revision/i }));
    await user.click(screen.getByRole("button", { name: /restore as a new revision/i }));

    await waitFor(() => expect(controller.revision).toBeGreaterThan(before));
    expect(controller.getState().preview).toBeUndefined();
    await waitFor(() => expect(screen.queryByText(/read-only/i)).toBeNull());
    // Old content is back, by moving forward.
    expect(screen.getByRole("heading", { name: "Overview" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Detail" })).toBeNull();
  });

  it("can be cancelled without acting", async () => {
    const { user, controller } = await preview();
    const before = controller.revision;
    await user.click(screen.getByRole("button", { name: /restore this revision/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(controller.revision).toBe(before);
    // Still previewing: cancelling the restore is not cancelling the navigation.
    expect(controller.getState().preview).toBeDefined();
  });
});

describe("honest about what it cannot show", () => {
  it("says so when the host serves no history, rather than rendering a dead control", async () => {
    await mount({ withHistory: false });
    await waitFor(() => {
      const notice = globalThis.document.querySelector('[data-workplane="history-unavailable"]');
      expect(notice?.textContent).toMatch(/checkpoints/i);
    });
    expect(screen.queryByRole("tablist", { name: "Navigate by" })).toBeNull();
  });

  it("does not present a truncated log as the whole story", async () => {
    await mount({ historyComplete: false });
    await waitFor(() => {
      expect(screen.getByText(/as far back as this host can see/i)).toBeDefined();
    });
  });
});
