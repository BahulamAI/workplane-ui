import { formatMoney, toMajor } from "@bahulam/workplane-data";
import type { RendererDefinition } from "@bahulam/workplane-react";
import { scenarioFromPercentages } from "@bahulam/workplane-testkit";

interface ScenarioSpec {
  field: "savings" | "projectedCost" | "narrative";
  baselineQueryId: string;
}

const FIELDS = new Set(["savings", "projectedCost", "narrative"]);

/**
 * A custom renderer, living in the application rather than the library.
 *
 * It exists to show the extension point: the block reads its baseline from a
 * declared `dataRef` and its assumptions from declared bindings, computes
 * deterministically, and renders. It commits nothing and calls no model —
 * changing an assumption re-runs exactly this, and nothing else.
 */
export const scenarioRenderer: RendererDefinition<ScenarioSpec> = {
  id: "workplane.scenario",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: false,
    selection: false,
    thumbnail: true,
    staticExport: true,
    suspend: false,
    requiresWebGL: false,
  },
  validate(spec: unknown) {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      return { ok: false as const, message: "Spec must be an object" };
    }
    const raw = spec as Record<string, unknown>;
    if (typeof raw.field !== "string" || !FIELDS.has(raw.field)) {
      return { ok: false as const, message: "field must be savings, projectedCost, or narrative", path: "/field" };
    }
    if (typeof raw.baselineQueryId !== "string") {
      return { ok: false as const, message: "baselineQueryId must be a string", path: "/baselineQueryId" };
    }
    return {
      ok: true as const,
      value: { field: raw.field as ScenarioSpec["field"], baselineQueryId: raw.baselineQueryId },
    };
  },
  summarize: (spec) => `scenario ${spec.field}`,
  Component: ({ spec, results, bindings, stale }) => {
    const result = results.get(spec.baselineQueryId);
    const eligible = Number(bindings.eligibleSharePercent ?? 60);
    const reduction = Number(bindings.reductionPercent ?? 20);

    if (!result || result.rows.length === 0) {
      return <div data-workplane="metric" data-state="loading"><span data-workplane="metric-value">—</span></div>;
    }
    if (!Number.isFinite(eligible) || !Number.isFinite(reduction)) {
      return (
        <div data-workplane="metric" data-state="empty">
          <span data-workplane="metric-value">—</span>
          <span data-workplane="metric-meta">Assumptions are incomplete</span>
        </div>
      );
    }

    const baselineMinorUnits = Number(result.rows[0]?.[0] ?? 0);
    const scenario = scenarioFromPercentages(baselineMinorUnits, eligible, reduction, result.sourceVersion);

    if (spec.field === "narrative") {
      return (
        <p data-workplane="fact">
          Reducing {scenario.reductionPercent}% of the {scenario.eligibleSharePercent}% eligible share of{" "}
          {formatMoney(scenario.baseline)} saves <strong>{formatMoney(scenario.savings)}</strong>, leaving{" "}
          {formatMoney(scenario.projectedCost)}.{" "}
          <span data-workplane="metric-meta">
            Baseline {scenario.baselineVersion} · formula {scenario.formulaVersion} · projection under stated
            assumptions, not a forecast
          </span>
        </p>
      );
    }

    const value = spec.field === "savings" ? scenario.savings : scenario.projectedCost;
    return (
      <div data-workplane="metric" data-state={stale ? "stale" : "ready"}>
        <span data-workplane="metric-value">{formatMoney(value)}</span>
        <span data-workplane="metric-meta">
          {toMajor(scenario.baseline).toLocaleString()} baseline · {scenario.eligibleSharePercent}% eligible ·{" "}
          {scenario.reductionPercent}% reduction
        </span>
        {stale ? <span data-workplane="stale-badge">Updating…</span> : null}
      </div>
    );
  },
};
