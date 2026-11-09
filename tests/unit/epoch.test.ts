import { describe, expect, it, vi } from "vitest";
import {
  DependencyCycleError,
  DependencyGraph,
  QueryCoordinator,
  type DataProvider,
  type EpochState,
  type QueryRequest,
  type QueryResult,
} from "@bahulam/workplane-ui";

function result(request: QueryRequest, value: number): QueryResult {
  return {
    resultId: `res_${request.queryId}_${request.generation}`,
    queryId: request.queryId,
    sourceVersion: "v1",
    parameterFingerprint: JSON.stringify(request.parameters),
    partition: "test",
    executedAt: new Date(0).toISOString(),
    columns: [{ name: "value", type: "number" }],
    rows: [[value]],
    rowCount: 1,
    rowCountIsEstimate: false,
    freshness: "fresh",
    generation: request.generation,
  };
}

describe("AC-06 — a late query response", () => {
  it("does not replace a newer result, even when it resolves last", async () => {
    const delays: Record<number, number> = { 1: 60, 2: 5 };
    const provider: DataProvider = {
      id: "slow",
      async execute(request) {
        // Generation 1 (the OLD date range) is deliberately slower than
        // generation 2, so the stale answer arrives after the fresh one.
        await new Promise((r) => setTimeout(r, delays[request.generation] ?? 0));
        return result(request, request.generation === 1 ? 1111 : 2222);
      },
    };

    const published: EpochState[] = [];
    const coordinator = new QueryCoordinator({
      provider,
      debounceMs: 0,
      onPublish: (state) => published.push(state),
    });

    const plan = (period: string) => [
      { queryId: "q", spec: {}, parameters: { period } },
    ];

    const first = coordinator.runNow(plan("2026-07"));
    await new Promise((r) => setTimeout(r, 1));
    const second = coordinator.runNow(plan("2026-08"));
    await Promise.all([first, second]);
    await new Promise((r) => setTimeout(r, 120));

    const final = coordinator.getState();
    expect(final.results.get("q")?.rows[0]?.[0]).toBe(2222);
    expect(final.results.get("q")?.generation).toBe(2);
    coordinator.dispose();
  });

  it("aborts the superseded request", async () => {
    const aborted: boolean[] = [];
    const provider: DataProvider = {
      id: "abortable",
      async execute(request) {
        request.signal?.addEventListener("abort", () => aborted.push(true));
        await new Promise((r) => setTimeout(r, 30));
        return result(request, request.generation);
      },
    };
    const coordinator = new QueryCoordinator({ provider, debounceMs: 0, onPublish: () => {} });
    void coordinator.runNow([{ queryId: "q", spec: {}, parameters: { v: 1 } }]);
    await new Promise((r) => setTimeout(r, 1));
    await coordinator.runNow([{ queryId: "q", spec: {}, parameters: { v: 2 } }]);
    expect(aborted.length).toBeGreaterThan(0);
    coordinator.dispose();
  });
});

describe("coherent epochs", () => {
  it("publishes a group only once every member has landed", async () => {
    const provider: DataProvider = {
      id: "mixed",
      async execute(request) {
        await new Promise((r) => setTimeout(r, request.queryId === "slow" ? 40 : 1));
        return result(request, 1);
      },
    };
    const published: EpochState[] = [];
    const coordinator = new QueryCoordinator({
      provider,
      debounceMs: 0,
      onPublish: (state) => published.push(state),
    });

    await coordinator.runNow([
      { queryId: "fast", spec: {}, parameters: {} },
      { queryId: "slow", spec: {}, parameters: {} },
    ]);
    await new Promise((r) => setTimeout(r, 60));

    // The fast result is never shown beside an empty slow one: no published
    // state has exactly one of the two.
    for (const state of published) {
      const landed = [...state.results.keys()].sort();
      expect(landed.length === 0 || landed.length === 2).toBe(true);
    }
    expect(coordinator.getState().epoch).toBe(1);
    coordinator.dispose();
  });

  it("coalesces a burst of changes into one execution", async () => {
    const execute = vi.fn(async (request: QueryRequest) => result(request, 1));
    const coordinator = new QueryCoordinator({
      provider: { id: "counted", execute },
      debounceMs: 20,
      onPublish: () => {},
    });
    for (const v of [1, 2, 3, 4, 5]) {
      coordinator.request([{ queryId: "q", spec: {}, parameters: { v } }]);
    }
    await new Promise((r) => setTimeout(r, 60));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].parameters).toEqual({ v: 5 });
    coordinator.dispose();
  });
});

describe("dependency graph", () => {
  it("maps a shared path change to the blocks that must repaint", () => {
    const graph = new DependencyGraph();
    graph.registerQuery({ queryId: "total", dependsOnPaths: ["/filters/period"] });
    graph.registerQuery({ queryId: "trend", dependsOnPaths: ["/filters/environment"] });
    graph.registerBlock({ blockId: "metric", dependsOnPaths: [], dependsOnQueries: ["total"] });
    graph.registerBlock({ blockId: "chart", dependsOnPaths: [], dependsOnQueries: ["trend"] });

    expect(graph.queriesAffectedBy("/filters/period")).toEqual(["total"]);
    expect(graph.blocksAffectedBy("/filters/period")).toEqual(["metric"]);
  });

  it("treats a parent path change as touching its children", () => {
    const graph = new DependencyGraph();
    graph.registerQuery({ queryId: "q", dependsOnPaths: ["/filters/period"] });
    expect(graph.queriesAffectedBy("/filters")).toEqual(["q"]);
  });

  it("fans out through query-to-query dependencies", () => {
    const graph = new DependencyGraph();
    graph.registerQuery({ queryId: "base", dependsOnPaths: ["/filters/period"] });
    graph.registerQuery({ queryId: "derived", dependsOnPaths: [], dependsOnQueries: ["base"] });
    expect(graph.queriesAffectedBy("/filters/period").sort()).toEqual(["base", "derived"]);
  });

  it("rejects a cycle at registration, not at evaluation", () => {
    const graph = new DependencyGraph();
    graph.registerQuery({ queryId: "a", dependsOnPaths: [], dependsOnQueries: ["b"] });
    graph.registerQuery({ queryId: "b", dependsOnPaths: [], dependsOnQueries: ["c"] });
    expect(() =>
      graph.registerQuery({ queryId: "c", dependsOnPaths: [], dependsOnQueries: ["a"] }),
    ).toThrow(DependencyCycleError);
    // The rejected registration must not be left behind.
    expect(graph.queriesAffectedBy("/anything")).toEqual([]);
  });
});
