import { useState } from "react";
import type { JsonValue } from "../../protocol/index.js";
import type { RendererDefinition } from "../registry.js";
import {
  columnIndex, describeColumn, formatCell, inlineMoneyColumn, inlineResult, isObject, requireString,
} from "./shared.js";

type TableSpec =
  | { source: "query"; queryId: string; columns: string[]; pageSize: number }
  /** Inline rows, positionally matching `columns`. A snapshot, not a query. */
  | { source: "inline"; columns: string[]; rows: JsonValue[][]; pageSize: number; moneyColumns?: string[]; currency?: string };

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
    if (!Array.isArray(spec.columns) || !spec.columns.every((c) => typeof c === "string")) {
      return { ok: false as const, message: '"columns" must be an array of strings', path: "/columns" };
    }
    const columns = spec.columns as string[];
    const pageSize = typeof spec.pageSize === "number" ? spec.pageSize : 25;
    if (pageSize < 1 || pageSize > 500) {
      return { ok: false as const, message: '"pageSize" must be between 1 and 500', path: "/pageSize" };
    }

    if (spec.queryId === undefined && Array.isArray(spec.rows)) {
      const rows = spec.rows as JsonValue[][];
      if (!rows.every((row) => Array.isArray(row))) {
        return { ok: false as const, message: '"rows" must be an array of arrays', path: "/rows" };
      }
      if (rows.length > 5000) {
        return { ok: false as const, message: "Inline tables are limited to 5000 rows", path: "/rows" };
      }
      const money = Array.isArray(spec.moneyColumns)
        ? (spec.moneyColumns as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      return {
        ok: true as const,
        value: {
          source: "inline" as const, columns, rows, pageSize,
          ...(money.length ? { moneyColumns: money } : {}),
          ...(typeof spec.currency === "string" ? { currency: spec.currency } : {}),
        },
      };
    }

    const queryId = requireString(spec, "queryId");
    if (!queryId.ok) return queryId;
    return { ok: true as const, value: { source: "query" as const, queryId: queryId.value, columns, pageSize } };
  },
  summarize: (spec) =>
    spec.source === "inline"
      ? `table of ${spec.columns.join(", ")} (inline, ${spec.rows.length} rows)`
      : `table of ${spec.columns.join(", ")} from ${spec.queryId}`,
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
