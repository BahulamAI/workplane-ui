import type { ValidationOutcome } from "../react/index.js";
import type { JsonValue } from "../protocol/index.js";

export interface InlinePoint {
  /** Stable entity id. Falls back to the label when absent. */
  id?: string;
  label: string;
  /** Integer minor units for money, a plain number otherwise. */
  value: number;
}

export interface EChartsSpec {
  chartType: "bar" | "line" | "pie";
  /**
   * Either a query reference or inline points.
   *
   * Inline exists because an agent has no way to add a QueryDescriptor in the
   * v0.1 operation set, so without it an agent could only chart data the host
   * had already declared — and an imported legacy widget, which carries literal
   * values and no query, could not render at all.
   */
  source: "query" | "inline";
  queryId?: string;
  categoryColumn?: string;
  valueColumn?: string;
  data?: InlinePoint[];
  currency?: string;
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

/** `pie` renders as a donut: a ring reads proportion without the centre
 *  wedge-angle ambiguity, and it is what legacy `donut_chart` widgets meant. */
const CHART_TYPES = new Set(["bar", "line", "pie"]);

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
    return { ok: false, message: 'chartType must be "bar", "line", or "pie"', path: "/chartType" };
  }

  const inline = raw.queryId === undefined && Array.isArray(raw.data);
  if (inline) {
    const points: InlinePoint[] = [];
    const rawPoints = raw.data as unknown[];
    if (rawPoints.length > 1000) {
      return { ok: false, message: "Inline charts are limited to 1000 points", path: "/data" };
    }
    for (const [index, entry] of rawPoints.entries()) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return { ok: false, message: "Each point must be an object", path: `/data/${index}` };
      }
      const point = entry as Record<string, unknown>;
      if (typeof point.label !== "string") {
        return { ok: false, message: '"label" must be a string', path: `/data/${index}/label` };
      }
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
        return { ok: false, message: '"value" must be a finite number', path: `/data/${index}/value` };
      }
      points.push({
        label: point.label,
        value: point.value,
        ...(typeof point.id === "string" ? { id: point.id } : {}),
      });
    }
    const value: EChartsSpec = {
      chartType: raw.chartType as EChartsSpec["chartType"],
      source: "inline",
      data: points,
      selectionMode: "none",
    };
    if (typeof raw.currency === "string") value.currency = raw.currency;
    if (typeof raw.entityType === "string") value.entityType = raw.entityType;
    return { ok: true, value };
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
    source: "query",
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
