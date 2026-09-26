/**
 * The Feed presenter and the seam it shares with expensive renderers.
 *
 * Most of these cases exist because the obvious implementation of a slideshow
 * breaks something else: it intercepts the wheel and the tables stop scrolling,
 * it binds arrow keys and the text fields stop working, it mounts every scene
 * and the fortieth deep link costs thirty-nine renders, or it unmounts scenes
 * and a half-typed form disappears.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDocument, LocalAuthority, MemoryStorage, WorkplaneController,
  type Block, type WorkplaneDocument,
} from "@bahulam/workplane-ui";
import {
  createNativeRegistry, createPresenterRegistry, Presenter, WorkplaneProvider,
} from "@bahulam/workplane-ui/react";

const controllers: WorkplaneController[] = [];
afterEach(() => {
  cleanup();
  for (const c of controllers.splice(0)) c.dispose();
});

function textBlock(id: string, text: string): Block {
  return {
    id, kind: "text", title: `Block ${id}`, rendererId: "workplane.text",
    specVersion: "1", spec: { text }, bindings: {}, dataRefs: [], fallback: text,
  };
}

function formBlock(id: string): Block {
  return {
    id, kind: "form", title: "Filters", rendererId: "workplane.form", specVersion: "1",
    spec: {
      fields: [{ name: "days", label: "Look back (days)", control: "number", path: "/filters/days" }],
      submitLabel: "Apply",
    },
    bindings: {}, dataRefs: [], fallback: "A filter form.",
  };
}

/** `count` scenes, each with one block. Scene n is `s{n}`. */
function manyScenes(count: number, extra?: (index: number) => Block | undefined): WorkplaneDocument {
  const base = createDocument({ id: "wp_feed", title: "Feed document" });
  const scenes: WorkplaneDocument["scenes"] = {};
  const blocks: WorkplaneDocument["blocks"] = {};
  const sceneOrder: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const sceneId = `s${index}`;
    const block = extra?.(index) ?? textBlock(`b${index}`, `Body of scene ${index}`);
    blocks[block.id] = block;
    scenes[sceneId] = { id: sceneId, title: `Scene ${index}`, layout: "flow", blockOrder: [block.id] };
    sceneOrder.push(sceneId);
  }
  return { ...base, sceneOrder, scenes, blocks };
}

async function mountFeed(
  document: WorkplaneDocument,
  view?: { activeSceneId?: string; feedAxis?: "horizontal" | "vertical" },
) {
  const controller = new WorkplaneController({
    gateway: new LocalAuthority({ storage: new MemoryStorage(document), policy: { writablePaths: [] } }),
    documentId: document.id,
    actor: { id: "u", type: "user", capabilities: [] },
    provider: { id: "none", async execute() { throw new Error("no data in this test"); } },
    debounceMs: 0,
  });
  controllers.push(controller);
  await controller.load();
  controller.session.patchViewState({ mode: "feed", ...view });

  render(
    <WorkplaneProvider controller={controller} renderers={createNativeRegistry()}>
      <Presenter controller={controller} registry={createPresenterRegistry()} />
    </WorkplaneProvider>,
  );
  return controller;
}

const sceneEl = (sceneId: string) =>
  globalThis.document.querySelector<HTMLElement>(`[data-workplane="feed-scene"][data-scene-id="${sceneId}"]`);

describe("Feed is a real presentation, not a fallback", () => {
  it("renders in feed mode with no unsupported notice", async () => {
    await mountFeed(manyScenes(3));
    expect(globalThis.document.querySelector('[data-mode="feed"]')).not.toBeNull();
    expect(globalThis.document.querySelector('[data-workplane="unsupported-mode"]')).toBeNull();
  });

  it("defaults to the horizontal axis", async () => {
    await mountFeed(manyScenes(3));
    expect(globalThis.document.querySelector('[data-workplane="feed-scroller"]')?.getAttribute("data-axis"))
      .toBe("horizontal");
  });

  it("presents the same scenes as the document, in order", async () => {
    const document = manyScenes(4);
    await mountFeed(document);
    const ids = [...globalThis.document.querySelectorAll('[data-workplane="feed-scene"]')]
      .map((element) => element.getAttribute("data-scene-id"));
    expect(ids).toEqual(document.sceneOrder);
  });
});

describe("only a window of scenes is mounted", () => {
  it("a deep link to scene 40 does not mount the preceding 39", async () => {
    await mountFeed(manyScenes(100), { activeSceneId: "s40" });

    // Every scene holds its place, so the scroll geometry is intact...
    expect(globalThis.document.querySelectorAll('[data-workplane="feed-scene"]').length).toBe(100);
    // ...but only the window renders its blocks.
    const mounted = [...globalThis.document.querySelectorAll('[data-workplane="block"]')]
      .map((element) => element.getAttribute("data-block-id"));
    expect(mounted.sort()).toEqual(["b39", "b40", "b41"]);
  });

  it("labels each scene with what it should be doing", async () => {
    await mountFeed(manyScenes(6), { activeSceneId: "s2" });
    const activity = (sceneId: string) => sceneEl(sceneId)?.getAttribute("data-activity");
    expect(activity("s2")).toBe("active");
    expect(activity("s1")).toBe("near");
    expect(activity("s3")).toBe("near");
    expect(activity("s5")).toBe("offscreen");
  });

  it("an unmounted scene still names itself, so the rail and the body agree", async () => {
    await mountFeed(manyScenes(6), { activeSceneId: "s0" });
    const placeholder = sceneEl("s4")?.querySelector('[data-workplane="feed-placeholder"]');
    expect(placeholder?.textContent).toContain("Scene 4");
  });

  it("a half-typed value survives its scene being unmounted", async () => {
    // This is the risk windowing introduces. Drafts live in the session store
    // precisely so that scrolling away cannot destroy one.
    const user = userEvent.setup();
    const controller = await mountFeed(
      manyScenes(6, (index) => (index === 0 ? formBlock("filters") : undefined)),
      { activeSceneId: "s0" },
    );

    await user.type(screen.getByLabelText("Look back (days)"), "45");
    expect(controller.session.getDraft("/filters/days")?.value).toBe(45);

    // Scroll far away: scene 0 leaves the window and unmounts.
    controller.session.patchViewState({ activeSceneId: "s5" });
    await waitFor(() => expect(screen.queryByLabelText("Look back (days)")).toBeNull());
    expect(controller.session.getDraft("/filters/days")?.value, "the draft died with the component").toBe(45);

    // Come back: the field is repopulated from the draft, not from committed state.
    controller.session.patchViewState({ activeSceneId: "s0" });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>("Look back (days)").value).toBe("45");
    });
  });
});

describe("Feed does not fight the things inside it", () => {
  it("never claims the wheel, so a table or a chart keeps the gesture", async () => {
    await mountFeed(manyScenes(3));
    const scroller = globalThis.document.querySelector('[data-workplane="feed-scroller"]')!;
    const wheel = new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true });
    scroller.dispatchEvent(wheel);
    // A presenter that advances scenes by counting wheel events has to call
    // preventDefault, and that is exactly what stops a table scrolling.
    expect(wheel.defaultPrevented, "the presenter intercepted the wheel").toBe(false);
  });

  it("advances on the arrow key for its axis", async () => {
    const user = userEvent.setup();
    const controller = await mountFeed(manyScenes(4), { activeSceneId: "s1" });
    const scroller = globalThis.document.querySelector<HTMLElement>('[data-workplane="feed-scroller"]')!;
    scroller.focus();

    await user.keyboard("{ArrowRight}");
    expect(controller.session.getViewState().activeSceneId).toBe("s2");
    await user.keyboard("{ArrowLeft}");
    expect(controller.session.getViewState().activeSceneId).toBe("s1");
  });

  it("uses the vertical arrows when the axis is vertical", async () => {
    const user = userEvent.setup();
    const controller = await mountFeed(manyScenes(4), { activeSceneId: "s1", feedAxis: "vertical" });
    globalThis.document.querySelector<HTMLElement>('[data-workplane="feed-scroller"]')!.focus();

    await user.keyboard("{ArrowDown}");
    expect(controller.session.getViewState().activeSceneId).toBe("s2");
    // The other axis is left alone, so a horizontal gesture still means nothing.
    await user.keyboard("{ArrowRight}");
    expect(controller.session.getViewState().activeSceneId).toBe("s2");
  });

  it("leaves the arrow keys to a focused text field", async () => {
    const user = userEvent.setup();
    const controller = await mountFeed(
      manyScenes(4, (index) => (index === 1 ? formBlock("filters") : undefined)),
      { activeSceneId: "s1" },
    );

    const field = screen.getByLabelText("Look back (days)");
    await user.click(field);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(
      controller.session.getViewState().activeSceneId,
      "pressing an arrow inside a text field advanced the scene",
    ).toBe("s1");
  });

  it("does not advance the scene for a modified arrow press", async () => {
    const user = userEvent.setup();
    const controller = await mountFeed(manyScenes(4), { activeSceneId: "s1" });
    globalThis.document.querySelector<HTMLElement>('[data-workplane="feed-scroller"]')!.focus();
    await user.keyboard("{Meta>}{ArrowRight}{/Meta}");
    expect(controller.session.getViewState().activeSceneId).toBe("s1");
  });

  it("offers an escape back to ordinary scrolling", async () => {
    const user = userEvent.setup();
    const controller = await mountFeed(manyScenes(3));
    await user.click(screen.getByRole("button", { name: "Exit to document view" }));
    expect(controller.session.getViewState().mode).toBe("document");
  });

  it("Escape leaves feed as well, since a slideshow can trap a reader", async () => {
    const user = userEvent.setup();
    const controller = await mountFeed(manyScenes(3));
    globalThis.document.querySelector<HTMLElement>('[data-workplane="feed-scroller"]')!.focus();
    await user.keyboard("{Escape}");
    expect(controller.session.getViewState().mode).toBe("document");
  });
});

describe("Feed navigation is navigation, not editing", () => {
  it("moving between scenes creates no revision", async () => {
    const controller = await mountFeed(manyScenes(5));
    const before = controller.document?.revision;
    controller.session.patchViewState({ activeSceneId: "s3" });
    await waitFor(() => expect(sceneEl("s3")?.getAttribute("data-activity")).toBe("active"));
    expect(controller.document?.revision).toBe(before);
  });

  it("the rail links at every scene and marks the current one", async () => {
    const user = userEvent.setup();
    await mountFeed(manyScenes(4));
    const rail = screen.getByRole("navigation", { name: "Scenes" });
    const links = within(rail).getAllByRole("link");
    expect(links.length).toBe(4);

    await user.click(links[2]!);
    await waitFor(() => expect(links[2]!.getAttribute("aria-current")).toBe("true"));
  });

  it("reports the reader's position", async () => {
    await mountFeed(manyScenes(7), { activeSceneId: "s3" });
    expect(screen.getByText(/4 of 7/)).toBeDefined();
  });

  it("disables the controls at the ends rather than wrapping", async () => {
    await mountFeed(manyScenes(3), { activeSceneId: "s0" });
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", false);
  });
});
