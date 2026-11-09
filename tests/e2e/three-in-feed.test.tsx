/**
 * The seam: an expensive renderer inside a windowing presenter.
 *
 * Neither piece is hard alone. What breaks is the join — a presenter that slides
 * through scenes while blocks hold WebGL contexts exhausts the browser's supply
 * and kills canvases elsewhere on the page, and a presenter that binds arrow
 * keys steals them from the thing the reader is trying to rotate.
 *
 * jsdom has no WebGL, which makes it exactly the right place to check the
 * degradation path: what a reader on a machine without a GPU actually sees.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDocument, LocalAuthority, MemoryStorage, WorkplaneController,
  threeContract, type Block, type WorkplaneDocument,
} from "@bahulam/workplane-ui";
import {
  createNativeRegistry, createPresenterRegistry, Presenter, WorkplaneProvider,
} from "@bahulam/workplane-ui/react";
import { liveWebGLContexts, threeRenderer } from "@bahulam/workplane-ui/three";

const controllers: WorkplaneController[] = [];
afterEach(() => {
  cleanup();
  for (const c of controllers.splice(0)) c.dispose();
});

function threeBlock(id: string): Block {
  return {
    id, kind: "scene3d", title: "Architecture", rendererId: "workplane.three",
    specVersion: "1", spec: threeContract.example,
    bindings: {}, dataRefs: [],
    fallback: "A 3D view of a service above its datastore.",
  };
}

function documentWith3D(sceneCount: number): WorkplaneDocument {
  const base = createDocument({ id: "wp_three", title: "3D document" });
  const scenes: WorkplaneDocument["scenes"] = {};
  const blocks: WorkplaneDocument["blocks"] = {};
  const sceneOrder: string[] = [];
  for (let index = 0; index < sceneCount; index += 1) {
    const block = threeBlock(`b${index}`);
    blocks[block.id] = block;
    scenes[`s${index}`] = { id: `s${index}`, title: `Scene ${index}`, layout: "flow", blockOrder: [block.id] };
    sceneOrder.push(`s${index}`);
  }
  return { ...base, sceneOrder, scenes, blocks };
}

async function mount(document: WorkplaneDocument, activeSceneId: string) {
  const controller = new WorkplaneController({
    gateway: new LocalAuthority({ storage: new MemoryStorage(document), policy: { writablePaths: [] } }),
    documentId: document.id,
    actor: { id: "u", type: "user", capabilities: [] },
    provider: { id: "none", async execute() { throw new Error("no data in this test"); } },
    debounceMs: 0,
  });
  controllers.push(controller);
  await controller.load();
  controller.session.patchViewState({ mode: "feed", activeSceneId });

  render(
    <WorkplaneProvider
      controller={controller}
      renderers={createNativeRegistry().register(threeRenderer)}
    >
      <Presenter controller={controller} registry={createPresenterRegistry()} />
    </WorkplaneProvider>,
  );
  return controller;
}

const blockEl = (id: string) => globalThis.document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
const threeState = (id: string) =>
  blockEl(id)?.querySelector('[data-workplane="three"]')?.getAttribute("data-state");

describe("a 3D block that cannot draw says so", () => {
  it("states the reason instead of rendering a blank rectangle", async () => {
    await mount(documentWith3D(1), "s0");
    await waitFor(() => expect(threeState("b0")).toBe("unavailable"));

    const detail = blockEl("b0")!.querySelector('[data-workplane="three-unavailable"]')!;
    // Both halves matter: what was meant to be here, and why it is not.
    expect(detail.textContent).toContain("A 3D view of a service above its datastore.");
    expect(detail.textContent).toMatch(/WebGL/i);
  });

  it("stays reachable without sight, whether or not it drew", async () => {
    await mount(documentWith3D(1), "s0");
    // The required alt text becomes the accessible name, and labelled parts are
    // appended — so the scene is legible as prose even with no canvas at all.
    const view = await screen.findByRole("img", { name: /stacked cubes/i });
    expect(view.getAttribute("aria-label")).toMatch(/Datastore/);
    expect(view.getAttribute("aria-label")).toMatch(/Service/);
  });

  it("leaks no context lease down the unavailable path", async () => {
    // The lease is process-wide. One renderer that acquires without releasing
    // silently reduces the budget for every 3D block afterwards.
    await mount(documentWith3D(1), "s0");
    await waitFor(() => expect(threeState("b0")).toBe("unavailable"));
    expect(liveWebGLContexts()).toBe(0);
  });
});

describe("the presenter and the renderer agree about who is working", () => {
  it("a block outside the window never asks for a context at all", async () => {
    await mount(documentWith3D(6), "s0");
    // s0 is active and s1 is near, so both attempt to draw. s4 is offscreen: it
    // is not mounted, so there is nothing to attempt.
    await waitFor(() => expect(threeState("b0")).toBe("unavailable"));
    expect(blockEl("b4"), "an offscreen scene mounted its block").toBeNull();
    expect(liveWebGLContexts()).toBe(0);
  });

  it("tells each mounted block what it should be doing", async () => {
    await mount(documentWith3D(6), "s2");
    await waitFor(() => expect(blockEl("b2")).not.toBeNull());
    const activity = (id: string) =>
      blockEl(id)?.querySelector('[data-workplane="three"]')?.getAttribute("data-activity");
    expect(activity("b2")).toBe("active");
    expect(activity("b1")).toBe("near");
    expect(activity("b3")).toBe("near");
  });

  it("a mounted-but-not-active block holds no context", async () => {
    await mount(documentWith3D(3), "s1");
    await waitFor(() => expect(blockEl("b0")).not.toBeNull());
    // "near" exists so that stepping to it is instant, NOT so that it can draw.
    expect(threeState("b0")).toBe("idle");
    expect(threeState("b2")).toBe("idle");
  });

  it("sliding through many scenes leaves no contexts behind", async () => {
    const controller = await mount(documentWith3D(12), "s0");
    for (const sceneId of ["s1", "s2", "s3", "s4", "s5", "s6", "s7"]) {
      controller.session.patchViewState({ activeSceneId: sceneId });
      await waitFor(() => expect(blockEl(sceneId.replace("s", "b"))).not.toBeNull());
    }
    // The point of the whole arrangement: the count does not grow with distance
    // travelled. Without release it would be eight by now, and the browser
    // would already have dropped the earliest canvases.
    expect(liveWebGLContexts()).toBe(0);
  });
});

describe("the 3D view owns its own keys", () => {
  it("is reachable by keyboard", async () => {
    await mount(documentWith3D(3), "s1");
    const view = await screen.findAllByRole("img", { name: /stacked cubes/i });
    expect(view[0]!.getAttribute("tabindex")).toBe("0");
  });

  it("says how to drive it", async () => {
    await mount(documentWith3D(1), "s0");
    expect(screen.getByText(/arrow keys to rotate/i)).toBeDefined();
  });

  it("an arrow press inside it rotates the scene rather than advancing the feed", async () => {
    const user = userEvent.setup();
    const controller = await mount(documentWith3D(4), "s1");
    const views = await screen.findAllByRole("img", { name: /stacked cubes/i });
    const active = blockEl("b1")!.querySelector<HTMLElement>('[data-workplane="three-canvas"]')!;
    expect(views).toContain(active);

    active.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");

    // This is the join. The presenter asks whether the focused element claimed
    // the arrows; the renderer marks itself as claiming them; so orbiting a
    // scene cannot also skip past it.
    expect(
      controller.session.getViewState().activeSceneId,
      "orbiting the 3D view advanced the feed instead",
    ).toBe("s1");
  });

  it("marks itself as claiming the keys, which is what the presenter checks", async () => {
    await mount(documentWith3D(1), "s0");
    const figure = blockEl("b0")!.querySelector('[data-workplane="three"]');
    expect(figure?.getAttribute("data-workplane-claims-keys")).toBe("true");
  });
});

describe("a context that is promised and then refused", () => {
  /**
   * The gap the other cases cannot reach: jsdom has no WebGL, so nothing above
   * ever takes a lease, and a leak in the release path would go unnoticed.
   *
   * Making the probe succeed while construction fails exercises exactly that —
   * acquire, fail, release — which is also a real browser condition: a context
   * lost between probing and constructing, or a driver that refuses.
   */
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  it("degrades with a reason and gives the lease back", async () => {
    HTMLCanvasElement.prototype.getContext = function getContext(kind: string) {
      // Enough for the availability probe to pass; three itself will not get far.
      if (kind.startsWith("webgl") || kind === "experimental-webgl") {
        return { getExtension: () => null } as unknown as RenderingContext;
      }
      return null;
    } as typeof HTMLCanvasElement.prototype.getContext;

    await mount(documentWith3D(1), "s0");
    await waitFor(() => expect(threeState("b0")).toBe("unavailable"));
    expect(blockEl("b0")!.querySelector('[data-workplane="three-unavailable"]')!.textContent)
      .toMatch(/could not start|WebGL/i);
    expect(liveWebGLContexts(), "the failed attempt kept its lease").toBe(0);
  });
});
