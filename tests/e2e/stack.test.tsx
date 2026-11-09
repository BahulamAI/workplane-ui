/**
 * Stack, and presentation parity across all three presenters.
 *
 * Section 5.4.4's requirements are mostly about restraint: only the active scene
 * is interactive, background layers are previews rather than live renderers, and
 * the wheel advances the stack without taking the gesture from a table, a chart,
 * or a 3D view inside the active scene.
 *
 * The parity cases (AC-21, AC-23, AC-27) could not be demonstrated before — the
 * PRD recorded them as "asserted but not demonstrated" while only one presenter
 * existed. Three do now.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDocument, LocalAuthority, MemoryStorage, WorkplaneController,
  type Actor, type Block, type WorkplaneDocument,
} from "@bahulam/workplane-ui";
import {
  createNativeRegistry, createPresenterRegistry, createStackPresenter,
  Presenter, WorkplaneProvider,
} from "@bahulam/workplane-ui/react";

const actor: Actor = { id: "u1", type: "user", capabilities: ["workplane.edit"] };
const controllers: WorkplaneController[] = [];
afterEach(() => {
  cleanup();
  for (const c of controllers.splice(0)) c.dispose();
});

function textBlock(id: string, text: string): Block {
  return {
    id, kind: "text", title: `Title ${id}`, rendererId: "workplane.text",
    specVersion: "1", spec: { text }, bindings: {}, dataRefs: [],
    fallback: `Fallback for ${id}`,
  };
}

/** A scene holding several kinds of block at once — AC-21. */
function mixedBlocks(suffix: string): Block[] {
  return [
    {
      id: `md_${suffix}`, kind: "markdown", title: "Narrative", rendererId: "workplane.markdown",
      specVersion: "1", spec: { markdown: "## Findings\n\nSpend rose in **compute**." },
      bindings: {}, dataRefs: [], fallback: "Written findings about spend.",
    },
    {
      id: `metric_${suffix}`, kind: "metric", title: "Total", rendererId: "workplane.metric",
      specVersion: "1", spec: { value: 142357, currency: "USD" },
      bindings: {}, dataRefs: [], fallback: "The total spend figure.",
    },
    {
      id: `table_${suffix}`, kind: "table", title: "Detail", rendererId: "workplane.table",
      specVersion: "1",
      spec: {
        columns: ["Service", "Cost"], rows: [["Compute", 5173448], ["Storage", 2013639]],
        moneyColumns: ["Cost"], currency: "USD", pageSize: 10,
      },
      bindings: {}, dataRefs: [], fallback: "A table of cost by service.",
    },
    {
      id: `form_${suffix}`, kind: "form", title: "Assumptions", rendererId: "workplane.form",
      specVersion: "1",
      spec: {
        fields: [{ name: "days", label: "Look back (days)", control: "number", path: "/filters/days" }],
        submitLabel: "Apply",
      },
      bindings: {}, dataRefs: [], fallback: "A form of assumptions.",
    },
  ];
}

function buildDocument(sceneCount: number, mixedScene?: number): WorkplaneDocument {
  const base = createDocument({ id: "wp_stack", title: "Stack document" });
  const scenes: WorkplaneDocument["scenes"] = {};
  const blocks: WorkplaneDocument["blocks"] = {};
  const sceneOrder: string[] = [];
  for (let index = 0; index < sceneCount; index += 1) {
    const sceneId = `s${index}`;
    const own = index === mixedScene ? mixedBlocks(sceneId) : [textBlock(`b${index}`, `Body ${index}`)];
    for (const block of own) blocks[block.id] = block;
    scenes[sceneId] = {
      id: sceneId, title: `Scene ${index}`, layout: "flow",
      blockOrder: own.map((b) => b.id),
    };
    sceneOrder.push(sceneId);
  }
  return { ...base, sceneOrder, scenes, blocks, shared: { filters: { days: 30 } } };
}

async function mount(
  document: WorkplaneDocument,
  options?: { mode?: "document" | "feed" | "stack"; activeSceneId?: string; stackDepth?: number },
) {
  const controller = new WorkplaneController({
    gateway: new LocalAuthority({
      storage: new MemoryStorage(document),
      policy: { writablePaths: [{ path: "/filters/days", schema: { type: "integer" } }] },
    }),
    documentId: document.id, actor, debounceMs: 0,
    provider: { id: "none", async execute() { throw new Error("no data in this test"); } },
  });
  controllers.push(controller);
  await controller.load();
  controller.session.patchViewState({
    mode: options?.mode ?? "stack",
    ...(options?.activeSceneId ? { activeSceneId: options.activeSceneId } : {}),
  });

  render(
    <WorkplaneProvider controller={controller} renderers={createNativeRegistry()}>
      <Presenter
        controller={controller}
        registry={createPresenterRegistry(options?.stackDepth ? { stackDepth: options.stackDepth } : undefined)}
      />
    </WorkplaneProvider>,
  );
  return controller;
}

const layer = (sceneId: string) =>
  globalThis.document.querySelector<HTMLElement>(`[data-workplane="stack-layer"][data-scene-id="${sceneId}"]`);
const layers = () => [...globalThis.document.querySelectorAll<HTMLElement>('[data-workplane="stack-layer"]')];

describe("the stack shows depth without mounting it", () => {
  it("renders the active scene plus a bounded number of cards behind it", async () => {
    await mount(buildDocument(10), { activeSceneId: "s0" });
    await waitFor(() => expect(layers().length).toBeGreaterThan(1));
    // Default depth is three, per 5.4.4: the active scene and three cards.
    expect(layers().length).toBe(4);
    expect(layers().map((l) => l.dataset.depth)).toEqual(["0", "1", "2", "3"]);
  });

  it("lets the host choose the depth, within a limit", async () => {
    cleanup();
    await mount(buildDocument(10), { activeSceneId: "s0", stackDepth: 1 });
    await waitFor(() => expect(layers().length).toBe(2));

    // Beyond the safe limit the request is clamped, not honoured: each card is
    // another mounted preview.
    const deep = createStackPresenter({ depth: 50 });
    expect(deep.mode).toBe("stack");
    cleanup();
    await mount(buildDocument(30), { activeSceneId: "s0", stackDepth: 50 });
    await waitFor(() => expect(layers().length).toBeGreaterThan(1));
    expect(layers().length).toBeLessThanOrEqual(6);
  });

  it("shows only the active scene's real blocks; the rest are previews", async () => {
    await mount(buildDocument(6, 0), { activeSceneId: "s0" });
    await waitFor(() => expect(layer("s0")).not.toBeNull());

    // The active scene renders its renderers...
    expect(within(layer("s0")!).getByRole("heading", { name: "Findings" })).toBeDefined();
    expect(layer("s0")!.querySelector('[data-workplane="block-preview"]')).toBeNull();

    // ...and a card behind it renders no renderer at all. Section 5.4.4: do not
    // mount a live chart, movie, or iframe per layer.
    const behind = layer("s1")!;
    expect(behind.querySelector('[data-workplane="block-preview"]')).not.toBeNull();
    expect(behind.querySelector('[data-workplane="block-title"]')).toBeNull();
  });

  it("previews a block using its own declared fallback text", async () => {
    await mount(buildDocument(4), { activeSceneId: "s0" });
    await waitFor(() => expect(layer("s1")).not.toBeNull());
    // `fallback` is already required on every block and already describes it, so
    // a preview needs no new authoring and no thumbnail pipeline.
    expect(layer("s1")!.textContent).toContain("Fallback for b1");
  });

  it("signals that the stack continues past the deepest card", async () => {
    await mount(buildDocument(10), { activeSceneId: "s0" });
    await waitFor(() => expect(layers().length).toBe(4));
    expect(globalThis.document.querySelector('[data-workplane="stack-more"]')).not.toBeNull();
  });

  it("drops that signal at the end, rather than implying more", async () => {
    const document = buildDocument(4);
    await mount(document, { activeSceneId: "s0" });
    await waitFor(() => expect(layers().length).toBe(4));
    expect(globalThis.document.querySelector('[data-workplane="stack-more"]')).toBeNull();
  });
});

describe("only the active scene is interactive", () => {
  it("marks background layers inert, not merely styled as inactive", async () => {
    await mount(buildDocument(5, 1), { activeSceneId: "s0" });
    await waitFor(() => expect(layer("s1")).not.toBeNull());

    // `inert` removes the subtree from pointer events, the focus order, AND the
    // accessibility tree together. Styling alone would leave a keyboard reader
    // traversing several copies of a document they cannot act on.
    expect(layer("s1")!.hasAttribute("inert")).toBe(true);
    expect(layer("s1")!.getAttribute("aria-hidden")).toBe("true");
    expect(layer("s0")!.hasAttribute("inert")).toBe(false);
    expect(layer("s0")!.getAttribute("aria-hidden")).toBeNull();
  });

  it("puts no focusable control inside a background layer's reachable tree", async () => {
    // The mixed scene has a form; as a card it must contribute no tab stop.
    await mount(buildDocument(5, 1), { activeSceneId: "s0" });
    await waitFor(() => expect(layer("s1")).not.toBeNull());
    expect(layer("s1")!.querySelectorAll("input, button, select, textarea, a[href]").length).toBe(0);
  });

  it("brings a card forward when it is clicked", async () => {
    const user = userEvent.setup();
    const controller = await mount(buildDocument(6), { activeSceneId: "s0" });
    await waitFor(() => expect(layer("s2")).not.toBeNull());

    // The card is inert, so the click lands on the layer wrapper, which is
    // exactly the affordance 5.4.4 describes.
    await user.click(layer("s2")!);
    await waitFor(() => expect(controller.session.getViewState().activeSceneId).toBe("s2"));
    expect(layer("s2")!.dataset.depth).toBe("0");
  });
});

describe("the wheel advances the stack without stealing the gesture", () => {
  function wheel(target: Element, deltaY: number): WheelEvent {
    const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  it("needs a deliberate gesture, not a nudge", async () => {
    const controller = await mount(buildDocument(6), { activeSceneId: "s1" });
    const stack = globalThis.document.querySelector('[data-workplane="stack"]')!;

    // Below the threshold nothing moves, and the browser keeps its own scroll:
    // a small gesture that never becomes navigation should behave like a scroll.
    const small = wheel(stack, 20);
    expect(controller.session.getViewState().activeSceneId).toBe("s1");
    expect(small.defaultPrevented).toBe(false);
  });

  it("steps once when the gesture crosses the threshold", async () => {
    const controller = await mount(buildDocument(6), { activeSceneId: "s1" });
    const stack = globalThis.document.querySelector('[data-workplane="stack"]')!;

    const decisive = wheel(stack, 200);
    await waitFor(() => expect(controller.session.getViewState().activeSceneId).toBe("s2"));
    expect(decisive.defaultPrevented, "navigating did not claim the gesture").toBe(true);
  });

  it("does not walk the whole stack on one inertial flick", async () => {
    const controller = await mount(buildDocument(12), { activeSceneId: "s0" });
    const stack = globalThis.document.querySelector('[data-workplane="stack"]')!;

    // One threshold crossing plus an inertial tail below it. Without the
    // accumulator resetting on each step, this would advance repeatedly.
    wheel(stack, 130);
    for (const tail of [40, 30, 20, 10, 5]) wheel(stack, tail);
    await waitFor(() => expect(controller.session.getViewState().activeSceneId).toBe("s1"));
    expect(controller.session.getViewState().activeSceneId).toBe("s1");
  });

  it("leaves the wheel alone when a child has claimed it", async () => {
    await mount(buildDocument(5, 0), { activeSceneId: "s0" });
    await waitFor(() => expect(layer("s0")).not.toBeNull());

    // A table's own scroll container is one of the things 5.4.4 names.
    const scroller = layer("s0")!.querySelector('[data-workplane="table-scroll"]')!;
    const event = wheel(scroller, 400);
    expect(event.defaultPrevented, "the stack took the table's scroll gesture").toBe(false);
  });
});

describe("Previous and Next are always available", () => {
  it("offers both, disabled at the ends rather than wrapping", async () => {
    await mount(buildDocument(3), { activeSceneId: "s0" });
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", false);
  });

  it("steps with the keyboard on either axis", async () => {
    const user = userEvent.setup();
    const controller = await mount(buildDocument(5), { activeSceneId: "s1" });
    globalThis.document.querySelector<HTMLElement>('[data-workplane="stack"]')!.focus();

    // Depth reads as both up/down and back/forward, so both pairs work.
    await user.keyboard("{ArrowDown}");
    expect(controller.session.getViewState().activeSceneId).toBe("s2");
    await user.keyboard("{ArrowLeft}");
    expect(controller.session.getViewState().activeSceneId).toBe("s1");
  });

  it("states the reader's position", async () => {
    await mount(buildDocument(12), { activeSceneId: "s2" });
    // "3 of 12", required by 5.4.4.
    expect(screen.getByText(/3 of 12/)).toBeDefined();
  });

  it("leaves the arrows to a focused field inside the active scene", async () => {
    const user = userEvent.setup();
    const controller = await mount(buildDocument(5, 0), { activeSceneId: "s0" });
    await user.click(screen.getByLabelText("Look back (days)"));
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(controller.session.getViewState().activeSceneId).toBe("s0");
  });
});

describe("AC-21/AC-23 — the same document in all three presentations", () => {
  it("exposes the whole mixed composition in every mode", async () => {
    const document = buildDocument(3, 0);
    const controller = await mount(document, { mode: "document" });

    for (const mode of ["document", "feed", "stack"] as const) {
      controller.session.patchViewState({ mode, activeSceneId: "s0" });
      await waitFor(() => {
        expect(globalThis.document.querySelector(`[data-mode="${mode}"]`)).not.toBeNull();
      });
      // Every kind of block in the scene is present, in every presentation. No
      // presenter imposes its own visual catalogue.
      for (const name of ["Narrative", "Total", "Detail", "Assumptions"]) {
        expect(
          screen.getByText(name, { selector: '[data-workplane="block-title"]' }),
          `${name} is missing in ${mode}`,
        ).toBeDefined();
      }
    }
  });

  it("switches presentation without touching the document", async () => {
    const controller = await mount(buildDocument(4, 0), { mode: "document" });
    const revisionBefore = controller.revision;
    const documentBefore = controller.document;

    for (const mode of ["feed", "stack", "document"] as const) {
      controller.session.patchViewState({ mode });
      await waitFor(() => expect(globalThis.document.querySelector(`[data-mode="${mode}"]`)).not.toBeNull());
    }

    // AC-23: no revision change, and the very same document object — nothing was
    // converted, rewritten, or re-fetched to change presentation.
    expect(controller.revision).toBe(revisionBefore);
    expect(controller.document).toBe(documentBefore);
  });

  it("carries a draft and a selection across every switch", async () => {
    const user = userEvent.setup();
    const controller = await mount(buildDocument(4, 0), { mode: "document" });

    const field = screen.getByLabelText("Look back (days)");
    await user.clear(field);
    await user.type(field, "45");
    controller.session.setSelection("table_s0", ["Compute"]);
    expect(controller.session.getDraft("/filters/days")?.value).toBe(45);

    for (const mode of ["feed", "stack", "document"] as const) {
      controller.session.patchViewState({ mode, activeSceneId: "s0" });
      await waitFor(() => expect(globalThis.document.querySelector(`[data-mode="${mode}"]`)).not.toBeNull());
      // Ephemeral state lives in the session store, outside component lifetimes,
      // which is what makes this survive being unmounted by any presenter.
      expect(controller.session.getDraft("/filters/days")?.value, `draft lost in ${mode}`).toBe(45);
      expect(controller.session.getSelection("table_s0"), `selection lost in ${mode}`).toEqual(["Compute"]);
    }

    // And the field still shows it after the round trip.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>("Look back (days)").value).toBe("45");
    });
  });

  it("commits the same way from every presentation", async () => {
    const user = userEvent.setup();
    const controller = await mount(buildDocument(3, 0), { mode: "stack", activeSceneId: "s0" });

    const field = await screen.findByLabelText("Look back (days)");
    await user.clear(field);
    await user.type(field, "14");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    // AC-22: editing is not a Document-mode privilege.
    await waitFor(() => {
      expect((controller.document!.shared.filters as { days: number }).days).toBe(14);
    });
  });
});
