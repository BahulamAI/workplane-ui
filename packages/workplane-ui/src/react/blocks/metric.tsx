import type { RendererDefinition } from "../registry.js";
import {
  columnIndex, describeColumn, formatCell, inlineMoneyColumn, inlineResult, isObject, requireString,
} from "./shared.js";

/**
 * Either a query reference or an inline value — never both.
 *
 * Inline money arrives in integer minor units, like every other money value in
 * the system. Accepting a float here would reintroduce per-renderer rounding.
 */
type MetricSpec =
  | { source: "query"; queryId: string; column: string; unit?: string }
  | { source: "inline"; value: number; currency?: string; unit?: string };

export const metricRenderer: RendererDefinition<MetricSpec> = {
  id: "workplane.metric",
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
    if (!isObject(spec)) return { ok: false as const, message: "Spec must be an object" };
    const unit = typeof spec.unit === "string" ? { unit: spec.unit } : {};

    if (spec.queryId === undefined && typeof spec.value === "number") {
      if (!Number.isFinite(spec.value)) {
        return { ok: false as const, message: '"value" must be finite', path: "/value" };
      }
      if (!Number.isInteger(spec.value)) {
        return {
          ok: false as const,
          message: '"value" must be integer minor units, not a decimal amount',
          path: "/value",
        };
      }
      return {
        ok: true as const,
        value: {
          source: "inline" as const,
          value: spec.value,
          ...(typeof spec.currency === "string" ? { currency: spec.currency } : {}),
          ...unit,
        },
      };
    }

    const queryId = requireString(spec, "queryId");
    if (!queryId.ok) return queryId;
    const column = requireString(spec, "column");
    if (!column.ok) return column;
    return {
      ok: true as const,
      value: { source: "query" as const, queryId: queryId.value, column: column.value, ...unit },
    };
  },
  summarize: (spec) =>
    spec.source === "inline" ? "metric (inline value)" : `metric ${spec.column} from ${spec.queryId}`,
  Component: ({ spec, results, stale, block }) => {
    const result =
      spec.source === "inline"
        ? inlineResult(block.id, [inlineMoneyColumn("value", spec.currency)], [[spec.value]])
        : results.get(spec.queryId);
    const columnName = spec.source === "inline" ? "value" : spec.column;
    if (!result) {
      return (
        <div data-workplane="metric" data-state="loading">
          <span data-workplane="metric-value">—</span>
        </div>
      );
    }
    const index = columnIndex(result, columnName);
    const column = result.columns[index];
    const value = result.rows[0]?.[index];

    return (
      <div data-workplane="metric" data-state={stale ? "stale" : "ready"}>
        <span data-workplane="metric-value">
          {value === undefined ? "—" : formatCell(value, column)}
        </span>
        <span data-workplane="metric-meta">{describeColumn(column)}</span>
        {stale ? <span data-workplane="stale-badge">Updating…</span> : null}
      </div>
    );
  },
};
