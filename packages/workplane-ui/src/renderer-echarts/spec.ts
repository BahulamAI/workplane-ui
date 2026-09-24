import type { ValidationOutcome } from "../react/index.js";
import type { JsonValue } from "../protocol/index.js";

export interface EChartsSpec {
  chartType: "bar" | "line";
  queryId: string;
  categoryColumn: string;
  valueColumn: string;
  /** Column holding the STABLE entity id, when it differs from the label. */
  entityColumn?: string;
  entityType?: string;
  /**
   * `filter` removes non-selected marks; `highlight` dims them but keeps the
   * user's context. The PRD prefers highlight on the source chart so the user
   * can still see what they selected against.
   */
  selectionMode?: "none" | "highlight" | "filter";
  /** Registered writable path the selection commits to. */
  selectionPath?: string;
}

const CHART_TYPES = new Set(["bar", "line"]);

/**
 * Validates the Workplane-owned spec. Note what this is NOT: an ECharts
 * `option` object. Accepting raw vendor options would let an agent supply
 * formatter functions, remote image URLs, and data loaders — so the adapter
 * BUILDS the option from validated fields instead.
 */
export function validateEChartsSpec(spec: unknown): ValidationOutcome<EChartsSpec> {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    return { ok: false, message: "Spec must be an object" };
  }
  const raw = spec as Record<string, JsonValue>;

  if (typeof raw.chartType !== "string" || !CHART_TYPES.has(raw.chartType)) {
    return { ok: false, message: 'chartType must be "bar" or "line"', path: "/chartType" };
  }
  for (const key of ["queryId", "categoryColumn", "valueColumn"]) {
    if (typeof raw[key] !== "string" || (raw[key] as string).length === 0) {
      return { ok: false, message: `"${key}" must be a non-empty string`, path: `/${key}` };
    }
  }
  const selectionMode = raw.selectionMode ?? "none";
  if (typeof selectionMode !== "string" || !["none", "highlight", "filter"].includes(selectionMode)) {
    return { ok: false, message: "selectionMode must be none, highlight, or filter", path: "/selectionMode" };
  }
  if (raw.selectionPath !== undefined && typeof raw.selectionPath !== "string") {
    return { ok: false, message: "selectionPath must be a JSON Pointer string", path: "/selectionPath" };
  }

  const value: EChartsSpec = {
    chartType: raw.chartType as EChartsSpec["chartType"],
    queryId: raw.queryId as string,
    categoryColumn: raw.categoryColumn as string,
    valueColumn: raw.valueColumn as string,
    selectionMode: selectionMode as EChartsSpec["selectionMode"],
  };
  if (typeof raw.entityColumn === "string") value.entityColumn = raw.entityColumn;
  if (typeof raw.entityType === "string") value.entityType = raw.entityType;
  if (typeof raw.selectionPath === "string") value.selectionPath = raw.selectionPath;
  return { ok: true, value };
}
