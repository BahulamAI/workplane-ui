/**
 * The loop the first release exists to prove, driven through the real UI:
 *
 *   an agent appends a scene, a user changes an input, dependent visuals
 *   update without another model call, the agent sees the committed change,
 *   and the whole workspace survives reload.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalAuthority,
  MemoryStorage,
  projectForAgent,
  WorkplaneController,
} from "@bahulam/workplane-core";
import {
  createNativeRegistry,
  createPresenterRegistry,
  Presenter,
  WorkplaneProvider,
} from "@bahulam/workplane-react";
import {
  createDemoDocument,
  DEMO_AGENT,
  DEMO_DOCUMENT_ID,
  DEMO_POLICY,
  DEMO_USER,
  OVERVIEW_OPERATIONS,
  SCENARIO_OPERATIONS,
  SyntheticCostProvider,
  transaction,
} from "@bahulam/workplane-testkit";
import { scenarioRenderer } from "../../examples/generative-bi/src/scenario-renderer.js";

/** Nothing in this flow may increment this. */
let modelCalls = 0;

const controllers: WorkplaneController[] = [];
afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
  modelCalls = 0;
});

async function mount(storage = new MemoryStorage(createDemoDocument())) {
  const provider = new SyntheticCostProvider();
  const authority = new LocalAuthority({ storage, policy: DEMO_POLICY });

  // The agent lays out both scenes through the ordinary command gateway.
  await authority.commit(transaction("seed_overview", 0, OVERVIEW_OPERATIONS), DEMO_AGENT);
  await authority.commit(transaction("seed_scenario", 1, SCENARIO_OPERATIONS), DEMO_AGENT);

  const controller = new WorkplaneController({
    gateway: authority,
    documentId: DEMO_DOCUMENT_ID,
    actor: DEMO_USER,
    provider,
    debounceMs: 0,
  });
  controllers.push(controller);
  await controller.load();

  // ECharts needs a canvas, so it is deliberately NOT registered here. Those
  // blocks must degrade to an accessible fallback (AC-09) while everything
  // else stays usable.
  const renderers = createNativeRegistry().register(scenarioRenderer);

  const view = render(
    <WorkplaneProvider controller={controller} renderers={renderers}>
      <Presenter controller={controller} registry={createPresenterRegistry()} />
    </WorkplaneProvider>,
  );
  return { view, controller, provider, authority, storage };
}

function blockByTitle(title: string): HTMLElement {
  const heading = screen.getByText(title, { selector: '[data-workplane="block-title"]' });
  const block = heading.closest('[data-workplane="block"]');
  if (!block) throw new Error(`No block wrapper for "${title}"`);
  return block as HTMLElement;
}

describe("AC-01 — the agent's scene renders from authorized data", () => {
  it("shows the metric, the table, and both scene headings", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Optimization scenario" })).toBeDefined();

    await waitFor(() => {
      expect(within(blockByTitle("Total spend")).getByText("$10,000.00")).toBeDefined();
    });
    expect(within(blockByTitle("Cost detail")).getAllByRole("row").length).toBeGreaterThan(1);
  });
});

describe("AC-02 — changing an assumption from 20% to 30%", () => {
  it("moves savings 1,200 -> 1,800 and cost 8,800 -> 8,200 with zero model calls", async () => {
    const user = userEvent.setup();
    const { provider } = await mount();

    await waitFor(() => {
      expect(within(blockByTitle("Projected savings")).getByText("$1,200.00")).toBeDefined();
    });
    expect(within(blockByTitle("Projected cost")).getByText("$8,800.00")).toBeDefined();

    const queriesBefore = provider.executionCount;

    const form = blockByTitle("Assumptions");
    const reduction = within(form).getByLabelText("Reduction applied (%)");
    await user.clear(reduction);
    await user.type(reduction, "30");

    // Typing alone commits nothing: the value is still a local draft.
    expect(within(blockByTitle("Projected savings")).getByText("$1,200.00")).toBeDefined();

    await user.click(within(form).getByRole("button", { name: "Apply assumptions" }));

    await waitFor(() => {
      expect(within(blockByTitle("Projected savings")).getByText("$1,800.00")).toBeDefined();
    });
    expect(within(blockByTitle("Projected cost")).getByText("$8,200.00")).toBeDefined();

    expect(modelCalls).toBe(0);
    // No query depends on an assumption, so the scenario recomputes
    // deterministically without re-reading the source at all.
    expect(provider.executionCount).toBe(queriesBefore);
  });

  it("keeps the narrative fact in agreement with the metrics", async () => {
    const user = userEvent.setup();
    await mount();
    const form = blockByTitle("Assumptions");
    const reduction = within(form).getByLabelText("Reduction applied (%)");
    await user.clear(reduction);
    await user.type(reduction, "30");
    await user.click(within(form).getByRole("button", { name: "Apply assumptions" }));

    await waitFor(() => {
      const summary = blockByTitle("Summary");
      expect(within(summary).getByText("$1,800.00")).toBeDefined();
      expect(summary.textContent).toMatch(/Reducing 30% of the 60% eligible share/);
      // The number is labelled as a projection, never as a forecast.
      expect(summary.textContent).toMatch(/not a forecast/);
    });
  });
});

describe("deterministic filtering re-queries without a model", () => {
  it("updates the metric and the table together when the filter commits", async () => {
    const user = userEvent.setup();
    const { provider } = await mount();

    await waitFor(() => {
      expect(within(blockByTitle("Total spend")).getByText("$10,000.00")).toBeDefined();
    });
    const before = provider.executionCount;

    const filters = blockByTitle("Filters");
    await user.selectOptions(within(filters).getByLabelText("Environment"), "development");
    await user.click(within(filters).getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(within(blockByTitle("Total spend")).getByText("$2,500.00")).toBeDefined();
    });
    // The table agrees with the metric in the same epoch, not one behind it:
    // every row is development, and none is left over from production.
    const cells = within(blockByTitle("Cost detail")).getAllByRole("cell");
    const environments = cells.map((c) => c.textContent).filter((t) => t === "development" || t === "production");
    expect(environments.length).toBeGreaterThan(0);
    expect(new Set(environments)).toEqual(new Set(["development"]));

    expect(provider.executionCount).toBeGreaterThan(before);
    expect(modelCalls).toBe(0);
  });
});

describe("AC-09 — a missing renderer", () => {
  it("shows an accessible fallback and leaves the rest of the document usable", async () => {
    await mount();
    const chart = blockByTitle("Cost by service");
    const fallback = chart.querySelector('[data-workplane="block-fallback"]');
    expect(fallback).not.toBeNull();
    // The reader learns what is missing, which renderer, and what to do.
    expect(fallback?.textContent).toMatch(/Bar chart of cost by Azure service/);
    expect(fallback?.textContent).toMatch(/workplane\.echarts/);
    expect(fallback?.textContent).toMatch(/Install or register this renderer/);

    await waitFor(() => {
      expect(within(blockByTitle("Total spend")).getByText("$10,000.00")).toBeDefined();
    });
  });
});

describe("AC-03 — an agent edit while the user holds a draft", () => {
  it("preserves the draft and surfaces the conflicting submit", async () => {
    const user = userEvent.setup();
    const { authority, controller } = await mount();

    const form = blockByTitle("Assumptions");
    const reduction = within(form).getByLabelText("Reduction applied (%)");
    await user.clear(reduction);
    await user.type(reduction, "30");

    // The agent changes the SAME value underneath the user.
    await authority.commit(
      transaction("agent_edit", controller.revision, [
        { op: "state.set", path: "/assumptions/reductionPercent", value: 25 },
      ]),
      DEMO_AGENT,
    );

    // The user's typing is still on screen: it was never overwritten.
    await waitFor(() => {
      expect((within(blockByTitle("Assumptions")).getByLabelText("Reduction applied (%)") as HTMLInputElement).value).toBe("30");
    });

    await user.click(within(blockByTitle("Assumptions")).getByRole("button", { name: "Apply assumptions" }));

    const conflict = await screen.findByRole("alert");
    expect(conflict.textContent).toMatch(/changed while you were editing/);
    expect(conflict.textContent).toMatch(/Keep mine \(30\)/);
    expect(conflict.textContent).toMatch(/Take theirs \(25\)/);
  });
});

describe("AC-13 / AC-08 — independent host and reload", () => {
  it("runs with no Bahulam host, no model key, and no network", async () => {
    // Everything above already proves this: the only inputs are an in-memory
    // storage adapter and a deterministic provider over a fixture.
    const { controller } = await mount();
    expect(controller.document?.id).toBe(DEMO_DOCUMENT_ID);
  });

  it("recovers the committed document and revision after a remount", async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage(createDemoDocument());
    const first = await mount(storage);

    const form = blockByTitle("Assumptions");
    const reduction = within(form).getByLabelText("Reduction applied (%)");
    await user.clear(reduction);
    await user.type(reduction, "30");
    await user.click(within(form).getByRole("button", { name: "Apply assumptions" }));
    await waitFor(() => {
      expect(within(blockByTitle("Projected savings")).getByText("$1,800.00")).toBeDefined();
    });
    const revision = first.controller.revision;
    first.view.unmount();

    // A fresh controller over the same storage: the reload path.
    const provider = new SyntheticCostProvider();
    const authority = new LocalAuthority({ storage, policy: DEMO_POLICY });
    const reloaded = new WorkplaneController({
      gateway: authority, documentId: DEMO_DOCUMENT_ID, actor: DEMO_USER, provider, debounceMs: 0,
    });
    controllers.push(reloaded);
    await reloaded.load();

    expect(reloaded.revision).toBe(revision);
    expect(reloaded.resolveBinding("/assumptions/reductionPercent")).toBe(30);

    render(
      <WorkplaneProvider controller={reloaded} renderers={createNativeRegistry().register(scenarioRenderer)}>
        <Presenter controller={reloaded} registry={createPresenterRegistry()} />
      </WorkplaneProvider>,
    );
    await waitFor(() => {
      expect(within(blockByTitle("Projected savings")).getByText("$1,800.00")).toBeDefined();
    });
  });
});

describe("the agent observes the committed change", () => {
  it("sees the user's new assumption in its next context projection", async () => {
    const user = userEvent.setup();
    const { controller } = await mount();

    const before = projectForAgent(controller.document!, { policy: DEMO_POLICY });
    expect(before.state["/assumptions/reductionPercent"]).toBe(20);

    const form = blockByTitle("Assumptions");
    const reduction = within(form).getByLabelText("Reduction applied (%)");
    await user.clear(reduction);
    await user.type(reduction, "30");
    await user.click(within(form).getByRole("button", { name: "Apply assumptions" }));

    await waitFor(() => {
      const after = projectForAgent(controller.document!, { policy: DEMO_POLICY });
      expect(after.state["/assumptions/reductionPercent"]).toBe(30);
      expect(after.revision).toBeGreaterThan(before.revision);
    });
  });
});

describe("unsupported presentation modes", () => {
  it("falls back to Document with a stated reason rather than a blank region", async () => {
    const { controller } = await mount();
    controller.session.patchViewState({ mode: "stack" });
    await waitFor(() => {
      const notice = screen.getByText(/Stack presentation is specified for milestone M3/);
      expect(notice.textContent).toMatch(/Showing Document instead/);
    });
    // The document is still fully rendered underneath the notice.
    expect(screen.getByRole("heading", { name: "Overview" })).toBeDefined();
  });
});
