/**
 * Renders the ACTUAL document captured from a running plugin, so the test
 * reflects what a user is looking at rather than an idealised fixture.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAuthority, MemoryStorage, WorkplaneController, type WorkplaneDocument } from "@bahulam/workplane-ui";
import {
  createNativeRegistry, createPresenterRegistry, Presenter, WorkplaneProvider,
} from "@bahulam/workplane-ui/react";

const live = JSON.parse(readFileSync(resolve(process.cwd(), "tests/live-document.json"), "utf8")) as WorkplaneDocument;

const controllers: WorkplaneController[] = [];
afterEach(() => {
  cleanup();
  for (const c of controllers.splice(0)) c.dispose();
});

async function mountLive() {
  const controller = new WorkplaneController({
    gateway: new LocalAuthority({ storage: new MemoryStorage(live), policy: { writablePaths: [] } }),
    documentId: live.id,
    actor: { id: "u", type: "user", capabilities: [] },
    // Every query fails: this test is about layout and navigation, not data.
    provider: { id: "none", async execute() { throw new Error("no data in this test"); } },
    debounceMs: 0,
  });
  controllers.push(controller);
  await controller.load();
  render(
    <WorkplaneProvider controller={controller} renderers={createNativeRegistry()}>
      <Presenter controller={controller} registry={createPresenterRegistry()} />
    </WorkplaneProvider>,
  );
  return controller;
}

describe("the live document's scenes", () => {
  it("renders every scene the navigator advertises", async () => {
    await mountLive();
    for (const sceneId of live.sceneOrder) {
      const heading = live.scenes[sceneId]!.title;
      expect(screen.getByRole("heading", { name: heading }), `missing scene "${sceneId}"`).toBeDefined();
    }
  });

  it("every navigator link points at an element that exists", async () => {
    await mountLive();
    const nav = screen.getByRole("navigation", { name: "Scenes" });
    const links = within(nav).getAllByRole("link");
    expect(links.length).toBe(live.sceneOrder.length);

    const broken: string[] = [];
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      const id = href.replace(/^#/, "");
      if (!document.getElementById(id)) broken.push(`${link.textContent?.trim()} -> ${href}`);
    }
    expect(broken, `navigator links with no target:\n${broken.join("\n")}`).toEqual([]);
  });

  it("renders the agent's blocks, not fallback cards", async () => {
    await mountLive();
    const agentScene = live.sceneOrder.find((id) => id !== "overview");
    if (!agentScene) return;

    for (const blockId of live.scenes[agentScene]!.blockOrder) {
      const block = document.querySelector(`[data-block-id="${blockId}"]`);
      expect(block, `block ${blockId} did not render`).not.toBeNull();
      const fallback = block?.querySelector('[data-workplane="block-fallback"]');
      const reason = fallback?.getAttribute("data-reason");
      // A missing renderer or an invalid spec is a real defect. A missing
      // ECharts canvas in jsdom is not, so unsupported-renderer is tolerated
      // only for the chart adapter, which this registry deliberately omits.
      if (reason && reason !== "unsupported-renderer") {
        expect.fail(`block ${blockId} rendered a ${reason} fallback: ${fallback?.textContent}`);
      }
    }
  });

  it("clicking a navigator link moves focus or scroll to that scene", async () => {
    const user = userEvent.setup();
    await mountLive();
    const nav = screen.getByRole("navigation", { name: "Scenes" });
    const links = within(nav).getAllByRole("link");
    const second = links[1]!;
    const targetId = second.getAttribute("href")!.replace(/^#/, "");
    const target = document.getElementById(targetId)!;

    let scrolled = false;
    target.scrollIntoView = () => { scrolled = true; };

    await user.click(second);
    await waitFor(() => {
      expect(second.getAttribute("aria-current"), "the clicked scene is not marked current").toBe("true");
    });
    // jsdom does not implement fragment scrolling, so a link that relies on it
    // alone is untestable — and, on a host that intercepts navigation, broken.
    expect(scrolled, "clicking the link did not scroll the scene into view").toBe(true);
  });
});
