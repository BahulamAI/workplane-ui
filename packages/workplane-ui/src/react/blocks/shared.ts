import { formatMoney, money, type QueryResult, type ResultColumn } from "../../data/index.js";
import type { JsonValue } from "../../protocol/index.js";
import type { ValidationOutcome } from "../registry.js";

export function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(
  spec: Record<string, JsonValue>,
  key: string,
): ValidationOutcome<string> {
  const value = spec[key];
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, message: `"${key}" must be a non-empty string`, path: `/${key}` };
  }
  return { ok: true, value };
}

export function columnIndex(result: QueryResult, name: string): number {
  return result.columns.findIndex((column) => column.name === name);
}

/**
 * Format a cell using the column's DECLARED semantics. A renderer never
 * decides whether a number is currency, a count, or a ratio — the provider
 * said so, and this just obeys.
 */
export function formatCell(value: JsonValue, column: ResultColumn | undefined): string {
  if (value === null || value === undefined) return "—";
  if (column?.type === "money" && typeof value === "number") {
    return formatMoney(money(value, column.currency ?? "USD"));
  }
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  return String(value);
}

/** A percentage must declare its numerator and denominator, or it is a lie. */
export function describeColumn(column: ResultColumn | undefined): string {
  if (!column) return "";
  const parts: string[] = [];
  if (column.aggregation) parts.push(column.aggregation);
  if (column.type === "money" && column.currency) parts.push(column.currency);
  if (column.aggregation === "ratio" && column.numerator && column.denominator) {
    parts.push(`${column.numerator} / ${column.denominator}`);
  }
  return parts.join(" · ");
}

/**
 * Build a result from values carried in the spec itself, so a block with no
 * query renders through exactly the same path as one with a query.
 *
 * Two cases need this. An imported legacy widget has literal numbers and no
 * query to re-run. And an agent that computed something itself has nothing to
 * point a `dataRef` at — the v0.1 operation set has no way to add a
 * QueryDescriptor, so without this it could not chart its own findings at all.
 *
 * Inline results are marked `freshness: "unknown"` and carry generation 0:
 * they are a snapshot, and nothing can refresh them.
 */
export function inlineResult(
  blockId: string,
  columns: ResultColumn[],
  rows: JsonValue[][],
): QueryResult {
  return {
    resultId: `inline_${blockId}`,
    queryId: `inline:${blockId}`,
    sourceVersion: "inline",
    parameterFingerprint: "inline",
    partition: "inline",
    executedAt: new Date(0).toISOString(),
    columns,
    rows,
    rowCount: rows.length,
    rowCountIsEstimate: false,
    freshness: "unknown",
    generation: 0,
  };
}

/** Money columns declared for inline data, which arrives already in minor units. */
export function inlineMoneyColumn(name: string, currency = "USD"): ResultColumn {
  return { name, type: "money", currency, aggregation: "sum" };
}
