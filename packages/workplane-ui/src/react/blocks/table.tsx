import { useState } from "react";
import type { RendererDefinition } from "../registry.js";
import { tableContract, type TableSpec } from "../../renderers/index.js";
import {
  columnIndex, describeColumn, formatCell, inlineMoneyColumn, inlineResult,
} from "./shared.js";

export const tableRenderer: RendererDefinition<TableSpec> = {
  ...tableContract,
  Component: ({ spec, results, stale, block }) => {
    const [page, setPage] = useState(0);
    const result =
      spec.source === "inline"
        ? inlineResult(
            block.id,
            spec.columns.map((name) =>
              spec.moneyColumns?.includes(name)
                ? inlineMoneyColumn(name, spec.currency)
                : { name, type: "string" as const },
            ),
            spec.rows,
          )
        : results.get(spec.queryId);

    if (!result) {
      return <div data-workplane="table" data-state="loading">Loading…</div>;
    }
    if (result.rows.length === 0) {
      return (
        <div data-workplane="table" data-state="empty">
          No rows match the current filters.
        </div>
      );
    }

    const indices = spec.columns.map((name) => columnIndex(result, name));
    const pageCount = Math.max(1, Math.ceil(result.rows.length / spec.pageSize));
    const current = Math.min(page, pageCount - 1);
    const rows = result.rows.slice(current * spec.pageSize, (current + 1) * spec.pageSize);

    return (
      <div data-workplane="table" data-state={stale ? "stale" : "ready"}>
        {/* Its own scroll container: scrolling a table must never advance the
            surrounding scene. */}
        <div data-workplane="table-scroll">
          <table>
            <caption>
              {block.title}
              {stale ? " (updating…)" : ""}
            </caption>
            <thead>
              <tr>
                {spec.columns.map((name, i) => (
                  <th key={name} scope="col" data-numeric={result.columns[indices[i] ?? -1]?.type === "money"}>
                    {name}
                    <span data-workplane="column-meta">{describeColumn(result.columns[indices[i] ?? -1])}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${current}-${rowIndex}`}>
                  {indices.map((index, i) => (
                    <td key={spec.columns[i]} data-numeric={result.columns[index]?.type === "money"}>
                      {formatCell(row[index] ?? null, result.columns[index])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 ? (
          <div data-workplane="table-pager">
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0}>
              Previous
            </button>
            <span>
              Page {current + 1} of {pageCount} · {result.rowCount}
              {result.rowCountIsEstimate ? "+ (estimated)" : ""} rows
            </span>
            <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1}>
              Next
            </button>
          </div>
        ) : null}
      </div>
    );
  },
};
