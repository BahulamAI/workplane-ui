import type { RendererDefinition } from "../registry.js";
import { columnIndex, describeColumn, formatCell, isObject, requireString } from "./shared.js";

interface MetricSpec {
  queryId: string;
  column: string;
  unit?: string;
}

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
    const queryId = requireString(spec, "queryId");
    if (!queryId.ok) return queryId;
    const column = requireString(spec, "column");
    if (!column.ok) return column;
    return {
      ok: true as const,
      value: {
        queryId: queryId.value,
        column: column.value,
        ...(typeof spec.unit === "string" ? { unit: spec.unit } : {}),
      },
    };
  },
  summarize: (spec) => `metric ${spec.column} from ${spec.queryId}`,
  Component: ({ spec, results, stale }) => {
    const result = results.get(spec.queryId);
    if (!result) {
      return (
        <div data-workplane="metric" data-state="loading">
          <span data-workplane="metric-value">—</span>
        </div>
      );
    }
    const index = columnIndex(result, spec.column);
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
