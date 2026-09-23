import { useState } from "react";
import type { RendererDefinition } from "../registry.js";
import { columnIndex, describeColumn, formatCell, isObject, requireString } from "./shared.js";

interface TableSpec {
  queryId: string;
  columns: string[];
  pageSize: number;
}

export const tableRenderer: RendererDefinition<TableSpec> = {
  id: "workplane.table",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: true,
    selection: false,
    thumbnail: false,
    staticExport: true,
    suspend: true,
    requiresWebGL: false,
  },
  validate(spec: unknown) {
    if (!isObject(spec)) return { ok: false as const, message: "Spec must be an object" };
    const queryId = requireString(spec, "queryId");
    if (!queryId.ok) return queryId;
    if (!Array.isArray(spec.columns) || !spec.columns.every((c) => typeof c === "string")) {
      return { ok: false as const, message: '"columns" must be an array of strings', path: "/columns" };
    }
    const pageSize = typeof spec.pageSize === "number" ? spec.pageSize : 25;
    if (pageSize < 1 || pageSize > 500) {
      return { ok: false as const, message: '"pageSize" must be between 1 and 500', path: "/pageSize" };
    }
    return { ok: true as const, value: { queryId: queryId.value, columns: spec.columns as string[], pageSize } };
  },
  summarize: (spec) => `table of ${spec.columns.join(", ")} from ${spec.queryId}`,
  Component: ({ spec, results, stale, block }) => {
    const [page, setPage] = useState(0);
    const result = results.get(spec.queryId);

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
