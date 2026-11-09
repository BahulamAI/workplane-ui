import type { RendererDefinition } from "../registry.js";
import { metricContract, type MetricSpec } from "../../renderers/index.js";
import {
  columnIndex, describeColumn, formatCell, inlineMoneyColumn, inlineResult,
} from "./shared.js";

export const metricRenderer: RendererDefinition<MetricSpec> = {
  ...metricContract,
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
