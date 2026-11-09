import type { BindingRef, JsonObject, JsonValue } from "../protocol/index.js";

export type ColumnType = "string" | "number" | "integer" | "boolean" | "date" | "money";

export interface ResultColumn {
  name: string;
  type: ColumnType;
  /** Declared for money and measures. A renderer must not guess. */
  unit?: string;
  currency?: string;
  /** How this column was aggregated. A renderer must not decide this. */
  aggregation?: "sum" | "avg" | "count" | "count-distinct" | "min" | "max" | "ratio";
  /** For a ratio, what it is a ratio OF. */
  numerator?: string;
  denominator?: string;
}

export type Freshness = "fresh" | "stale" | "unknown";

/**
 * An authorized, versioned, materialized view. Result pages live OUTSIDE the
 * document — a block references the query, not the rows.
 */
export interface QueryResult {
  resultId: string;
  queryId: string;
  /** Version of the underlying source, for reproducibility claims. */
  sourceVersion: string;
  /** Fingerprint of the resolved parameters that produced this result. */
  parameterFingerprint: string;
  /** Authorization partition. Two partitions never share a cache entry. */
  partition: string;
  executedAt: string;
  columns: ResultColumn[];
  rows: JsonValue[][];
  rowCount: number;
  rowCountIsEstimate: boolean;
  pageToken?: string;
  freshness: Freshness;
  /**
   * Monotonic per-query counter. A result whose generation is behind the
   * query's current generation is discarded, even if it arrives last.
   */
  generation: number;
}

export interface QueryRequest {
  queryId: string;
  spec: JsonValue;
  parameters: JsonObject;
  generation: number;
  pageToken?: string;
  signal?: AbortSignal;
}

/**
 * The data boundary. An implementation validates columns, operations, limits,
 * and access before execution, against an authenticated context the host
 * supplies — never a tenant id read out of the document.
 */
export interface DataProvider {
  readonly id: string;
  execute(request: QueryRequest): Promise<QueryResult>;
}

export interface ParameterizedQuery {
  id: string;
  dataSourceId: string;
  spec: JsonValue;
  parameters: Record<string, BindingRef>;
}
