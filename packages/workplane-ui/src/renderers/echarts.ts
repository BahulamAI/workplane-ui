import {
  DEFAULT_SPEC_LIMITS,
  describeKeyTree,
  sanitizeSpec,
  type KeyTree,
  type SpecLimits,
  type SpecViolation,
} from "../core/index.js";
import type { JsonValue } from "../protocol/index.js";
import type { RendererContract, ValidationOutcome } from "./contract.js";

/**
 * The ECharts contract: allowlist, validation and advertised examples.
 *
 * Headless on purpose. Validation and the catalog entry must be reachable
 * without loading ECharts or React, so a host can tell an agent what a chart
 * spec looks like whether or not the chart adapter is installed. The component
 * lives in `../renderer-echarts`, which is the only place the peer is imported.
 */
/**
 * The slice of ECharts' option surface this adapter accepts.
 *
 * PRD-108 VC-05: the engine owns its visual vocabulary. So an agent writes
 * ECharts — `series[].lineStyle.type: "dashed"`, per-series `color`, a second
 * y-axis — and multi-series comes free because it is ECharts' own shape, not
 * something Workplane had to invent and then maintain against every other
 * engine.
 *
 * Deliberately narrow to begin with, per section 10.3: widen on evidence that a
 * plugin needs something, not in anticipation. Everything absent is DROPPED,
 * not rejected, so adding a key later cannot break a document written today.
 *
 * Absent by design and unlikely ever to be added:
 *   graphic       arbitrary shapes and text, a second rendering surface
 *   dataset       its own transform language
 *   toolbox       saveAsImage and friends reach outside the block
 *   animation*    timing belongs to the presenter, not the block
 * Absent because they take URLs, which the envelope refuses anyway:
 *   backgroundColor as an image, symbol: "image://…", rich text images
 */

const TEXT_STYLE: KeyTree = {
  color: true, fontSize: true, fontWeight: true, fontFamily: true, fontStyle: true,
};

const LINE_STYLE: KeyTree = {
  // `type` is what makes multi-series readable without relying on colour.
  type: true, width: true, color: true, opacity: true, cap: true, join: true,
};

const ITEM_STYLE: KeyTree = {
  color: true, borderColor: true, borderWidth: true, borderType: true,
  opacity: true, borderRadius: true,
};

const LABEL: KeyTree = {
  show: true, position: true, formatter: true, ...TEXT_STYLE,
};

const AXIS: KeyTree = {
  type: true, name: true, nameLocation: true, nameGap: true, data: { $array: true },
  min: true, max: true, scale: true, boundaryGap: true, inverse: true,
  position: true, offset: true, show: true, gridIndex: true,
  axisLabel: { show: true, formatter: true, rotate: true, margin: true, interval: true, ...TEXT_STYLE },
  axisLine: { show: true, lineStyle: LINE_STYLE },
  axisTick: { show: true, alignWithLabel: true, interval: true },
  splitLine: { show: true, lineStyle: LINE_STYLE },
  nameTextStyle: TEXT_STYLE,
};

const MARK: KeyTree = {
  data: { $array: { name: true, type: true, xAxis: true, yAxis: true, value: true,
                    valueDim: true, itemStyle: ITEM_STYLE, lineStyle: LINE_STYLE, label: LABEL } },
  symbol: true, symbolSize: true, label: LABEL, lineStyle: LINE_STYLE, itemStyle: ITEM_STYLE,
};

const SERIES: KeyTree = {
  id: true, name: true, type: true,
  // Points, pairs, or objects with a name and value. Entity ids ride along as
  // `id` so a selection maps to a business entity rather than an array index.
  data: { $array: true },
  encode: true, xAxisIndex: true, yAxisIndex: true, stack: true,
  smooth: true, step: true, showSymbol: true, symbol: true, symbolSize: true, connectNulls: true,
  areaStyle: { color: true, opacity: true, origin: true },
  lineStyle: LINE_STYLE, itemStyle: ITEM_STYLE, label: LABEL,
  emphasis: { focus: true, itemStyle: ITEM_STYLE, lineStyle: LINE_STYLE, label: LABEL },
  barWidth: true, barMaxWidth: true, barGap: true, barCategoryGap: true,
  radius: true, center: true, roseType: true, avoidLabelOverlap: true, labelLine: { show: true, length: true, length2: true },
  markLine: MARK, markPoint: MARK, markArea: MARK,
  z: true, zlevel: true, silent: true, large: true, sampling: true, clip: true,
};

/** The accepted ECharts option subset. */
export const ECHARTS_ALLOW: KeyTree = {
  series: { $array: SERIES, orSingle: true },
  xAxis: { $array: AXIS, orSingle: true },
  yAxis: { $array: AXIS, orSingle: true },
  grid: { $array: { left: true, right: true, top: true, bottom: true, containLabel: true, show: true }, orSingle: true },
  legend: {
    show: true, type: true, data: { $array: true }, orient: true,
    top: true, bottom: true, left: true, right: true,
    selectedMode: true, textStyle: TEXT_STYLE, icon: true,
  },
  tooltip: {
    show: true, trigger: true, axisPointer: { type: true, lineStyle: LINE_STYLE },
    // A string template only. A function cannot survive JSON, and the envelope
    // refuses anything that looks like code.
    formatter: true, valueFormatter: true, confine: true, textStyle: TEXT_STYLE,
  },
  title: { show: true, text: true, subtext: true, left: true, top: true, textStyle: TEXT_STYLE },
  color: { $array: true },
  backgroundColor: true,
  textStyle: TEXT_STYLE,
};

/**
 * Charts carry more data than prose, so they get a larger budget than the
 * default — but a bounded one. A million-point series belongs behind a query
 * with aggregation, not inside a document (section 13.4).
 */
export const ECHARTS_LIMITS: Partial<SpecLimits> = {
  maxNodes: 60_000,
  maxBytes: 512 * 1024,
  maxArrayLength: 10_000,
};

/**
 * A chart specification is an ECharts option plus Workplane's data plumbing.
 *
 * The split follows PRD-108 VC-05 and section 14.4. `option` is the engine's
 * own vocabulary, so multi-series, dashed lines, per-series colour and a second
 * axis all arrive without Workplane inventing a grammar it would then have to
 * maintain against Vega-Lite, Plotly and deck.gl. `bind` is the part Workplane
 * does own: which query supplies which series, and which column carries the
 * stable entity id.
 */
export interface SeriesBinding {
  /** Index into `option.series`. */
  index: number;
  /** Result column supplying this series' values. */
  valueColumn: string;
  /** Column holding the stable business id, when it differs from the label. */
  entityColumn?: string;
}

export interface DataBinding {
  queryId: string;
  /** Column supplying the shared category axis. */
  categoryColumn?: string;
  series: SeriesBinding[];
}

export interface EChartsSpec {
  /** Validated ECharts option. Unknown keys have been dropped. */
  option: Record<string, JsonValue>;
  /** Absent for a chart whose data is written inline in the option. */
  bind?: DataBinding;
  entityType?: string;
  selectionMode: "none" | "highlight" | "filter";
  selectionPath?: string;
  /** Keys the allowlist removed, surfaced so an author is not left guessing. */
  dropped: string[];
}

/**
 * Every failure carries the accepted shape.
 *
 * An error that says what is wrong but not what is right costs a round trip and
 * invites a guess. The catalog carries the same text, but an agent that already
 * has a spec in hand is reading this, not the catalog.
 */
const SHAPE_HINT =
  'Expected: { option: { xAxis: [{ type: "category", data: [...] }], yAxis: [{ type: "value" }], ' +
  'series: [{ name, type: "line"|"bar"|"pie", data: [...], lineStyle: { type: "dashed" } }] }, ' +
  'bind?: { queryId, categoryColumn, series: [{ index, valueColumn }] } }. ' +
  "Axes, grid and series also accept a single object instead of an array.";

function fail(message: string, path?: string): ValidationOutcome<EChartsSpec> {
  const withHint = `${message}. ${SHAPE_HINT}`;
  return path ? { ok: false, message: withHint, path } : { ok: false, message: withHint };
}

function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Multi-series charts must be distinguishable without colour.
 *
 * This is the one opinion Workplane imposes on appearance, and it is not a
 * stylistic preference: colour-only encoding fails WCAG 2.2 AA, which section
 * 20 commits to. It is a rule on the envelope, not a grammar — an adapter for
 * any other engine would enforce the same requirement in that engine's terms.
 */
function checkSeriesDistinguishable(option: Record<string, JsonValue>): SpecViolation | null {
  const series = Array.isArray(option.series) ? (option.series as Record<string, JsonValue>[]) : [];
  const drawn = series.filter((s) => isObject(s) && s.type !== "pie");
  if (drawn.length < 2) return null;

  // Bars occupy distinct positions and stacks distinct bands, so neither needs
  // a pattern. Lines overlap, and two lines sharing a dash pattern differ only
  // by colour however many colours are in play.
  const lines = drawn.filter((s) => s.type !== "bar" && typeof s.stack !== "string");
  if (lines.length < 2) return null;

  const encodingOf = (s: Record<string, JsonValue>): string => {
    const lineStyle = isObject(s.lineStyle) ? s.lineStyle : undefined;
    const dash = typeof lineStyle?.type === "string" ? lineStyle.type : "solid";
    const symbol = typeof s.symbol === "string" ? s.symbol : "none";
    return `${dash}|${symbol}`;
  };

  const byEncoding = new Map<string, string[]>();
  lines.forEach((s, index) => {
    const name = typeof s.name === "string" ? s.name : `series ${index}`;
    byEncoding.set(encodingOf(s), [...(byEncoding.get(encodingOf(s)) ?? []), name]);
  });

  const clashing = [...byEncoding.values()].filter((names) => names.length > 1);
  if (clashing.length === 0) return null;

  return {
    path: "/option/series",
    message:
      `These line series are distinguishable only by colour: ${clashing
        .map((names) => names.join(" and "))
        .join("; ")}. Give each a different lineStyle.type ("solid", "dashed", "dotted", ` +
      `"dashdot") or a different symbol. Colour alone is unreadable for roughly one in twelve ` +
      "men (WCAG 2.2 AA, which PRD section 20 commits to).",
  };
}

/**
 * Compatibility: the earlier Workplane-owned shape, compiled into an option.
 *
 * Kept so documents written before the envelope keep rendering. New charts
 * should send `option` directly; this shape cannot express multi-series, which
 * is what prompted the change.
 */
const SIMPLE_TYPES = new Set(["bar", "line", "pie"]);

function fromSimpleShape(raw: Record<string, JsonValue>): unknown | { error: string } {
  const chartType = String(raw.chartType ?? "");
  // Never coerce. Quietly turning a requested sunburst into a bar chart shows
  // the right numbers in the wrong form and says nothing about it.
  if (!SIMPLE_TYPES.has(chartType)) {
    return {
      error:
        `chartType "${chartType}" is not one of bar, line, pie. For anything else, send an ` +
        'ECharts option directly: { option: { series: [{ type: "…" }] } } — subject to the ' +
        "renderer's accepted key list.",
    };
  }
  const inline = Array.isArray(raw.data)
    ? (raw.data as Record<string, JsonValue>[]).map((p) => ({
        name: String(p?.label ?? ""),
        value: Number(p?.value ?? 0),
        ...(typeof p?.id === "string" ? { id: p.id } : {}),
      }))
    : undefined;

  const option: Record<string, unknown> = {
    series: [{ type: chartType, ...(inline ? { data: inline } : {}) }],
    tooltip: { trigger: "item" },
  };
  if (chartType === "pie") {
    (option.series as Record<string, unknown>[])[0]!.radius = ["45%", "72%"];
    option.legend = { type: "scroll", bottom: 0 };
  } else {
    option.xAxis = [{ type: "category", ...(inline ? { data: inline.map((p) => p.name) } : {}) }];
    option.yAxis = [{ type: "value" }];
    option.grid = [{ left: 8, right: 16, top: 24, bottom: 8, containLabel: true }];
  }

  const bind =
    typeof raw.queryId === "string" && typeof raw.valueColumn === "string"
      ? {
          queryId: raw.queryId,
          ...(typeof raw.categoryColumn === "string" ? { categoryColumn: raw.categoryColumn } : {}),
          series: [
            {
              index: 0,
              valueColumn: raw.valueColumn,
              ...(typeof raw.entityColumn === "string" ? { entityColumn: raw.entityColumn } : {}),
            },
          ],
        }
      : undefined;

  return {
    option,
    ...(bind ? { bind } : {}),
    ...(typeof raw.entityType === "string" ? { entityType: raw.entityType } : {}),
    ...(typeof raw.selectionMode === "string" ? { selectionMode: raw.selectionMode } : {}),
    ...(typeof raw.selectionPath === "string" ? { selectionPath: raw.selectionPath } : {}),
  };
}

export function validateEChartsSpec(spec: unknown): ValidationOutcome<EChartsSpec> {
  if (!isObject(spec)) return fail("Spec must be an object");

  // Accept the pre-envelope shape by compiling it, rather than breaking every
  // document that already uses it.
  let source = spec;
  if (spec.option === undefined && spec.chartType !== undefined) {
    const compiled = fromSimpleShape(spec);
    if (compiled && typeof compiled === "object" && "error" in compiled) {
      return fail((compiled as { error: string }).error, "/chartType");
    }
    source = compiled as Record<string, JsonValue>;
  }

  if (!isObject(source.option)) {
    return fail(
      'A chart needs an "option": the ECharts option object, e.g. ' +
        '{ option: { series: [{ type: "line", data: [...] }], xAxis: [...], yAxis: [...] } }',
      "/option",
    );
  }

  const sanitized = sanitizeSpec<Record<string, JsonValue>>(source.option, {
    allow: ECHARTS_ALLOW,
    limits: { ...DEFAULT_SPEC_LIMITS, ...ECHARTS_LIMITS },
  });
  if (!sanitized.ok) {
    const first = sanitized.violations[0] as SpecViolation;
    return fail(first.message, `/option${first.path}`);
  }
  const option = sanitized.value;

  if (!Array.isArray(option.series) || option.series.length === 0) {
    return fail('"option.series" must be a non-empty array', "/option/series");
  }

  const accessibility = checkSeriesDistinguishable(option);
  if (accessibility) return fail(accessibility.message, accessibility.path);

  let bind: DataBinding | undefined;
  if (source.bind !== undefined) {
    if (!isObject(source.bind)) return fail('"bind" must be an object', "/bind");
    const raw = source.bind;
    if (typeof raw.queryId !== "string" || raw.queryId.length === 0) {
      return fail('"bind.queryId" must name a query declared on the block', "/bind/queryId");
    }
    if (!Array.isArray(raw.series) || raw.series.length === 0) {
      return fail('"bind.series" must map at least one series to a column', "/bind/series");
    }
    const series: SeriesBinding[] = [];
    for (const [i, entry] of raw.series.entries()) {
      if (!isObject(entry)) return fail("Each binding must be an object", `/bind/series/${i}`);
      const index = Number(entry.index);
      if (!Number.isInteger(index) || index < 0 || index >= (option.series as unknown[]).length) {
        return fail(
          `"index" must point at a series in option.series (0..${(option.series as unknown[]).length - 1})`,
          `/bind/series/${i}/index`,
        );
      }
      if (typeof entry.valueColumn !== "string" || !entry.valueColumn) {
        return fail('"valueColumn" must be a result column name', `/bind/series/${i}/valueColumn`);
      }
      series.push({
        index,
        valueColumn: entry.valueColumn,
        ...(typeof entry.entityColumn === "string" ? { entityColumn: entry.entityColumn } : {}),
      });
    }
    bind = {
      queryId: raw.queryId,
      ...(typeof raw.categoryColumn === "string" ? { categoryColumn: raw.categoryColumn } : {}),
      series,
    };
  }

  const selectionMode = typeof source.selectionMode === "string" ? source.selectionMode : "none";
  if (!["none", "highlight", "filter"].includes(selectionMode)) {
    return fail("selectionMode must be none, highlight, or filter", "/selectionMode");
  }

  return {
    ok: true,
    value: {
      option,
      ...(bind ? { bind } : {}),
      ...(typeof source.entityType === "string" ? { entityType: source.entityType } : {}),
      selectionMode: selectionMode as EChartsSpec["selectionMode"],
      ...(typeof source.selectionPath === "string" ? { selectionPath: source.selectionPath } : {}),
      dropped: sanitized.dropped,
    },
  };
}

export function summarizeEChartsSpec(spec: EChartsSpec): string {
  // series is `orSingle`: a single-series chart may arrive as one object.
  // Reading it as an array only would report "0 series" for every donut.
  const raw = spec.option.series;
  const series = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]) as Record<string, JsonValue>[];
  const kinds = [...new Set(series.map((s) => String(s?.type ?? "?")))].join("/");
  return `${series.length} ${kinds} series${spec.bind ? ` from ${spec.bind.queryId}` : " (inline)"}`;
}

/** What this adapter accepts, for catalog discovery by an agent. */
export function echartsSpecShape(): string {
  return (
    "{ option: <ECharts option>, bind?: { queryId, categoryColumn?, series: [{ index, valueColumn, entityColumn? }] }, " +
    "entityType?, selectionMode?: none|highlight|filter, selectionPath? }\n" +
    `option accepts: ${describeKeyTree(ECHARTS_ALLOW)}`
  );
}

export const echartsContract: RendererContract<EChartsSpec> = {
  id: "workplane.echarts",
  specVersions: ["1"],
  trust: "host-reviewed",
  requires: "echarts",
  capabilities: {
    interactive: true,
    selection: true,
    thumbnail: true,
    staticExport: true,
    suspend: true,
    requiresWebGL: false,
  },
  purpose:
    "Charts: bar, line, pie, donut, stacked, multi-series. The `option` field is an ECharts " +
    "option object. series/xAxis/yAxis each accept one object or an array. Multiple lines must " +
    "differ by lineStyle.type or symbol, not colour alone.",
  example: {
    option: {
      xAxis: { type: "category", data: ["Jan", "Feb", "Mar"] },
      yAxis: { type: "value" },
      series: [
        { type: "line", name: "Actual", data: [120, 132, 101], lineStyle: { type: "solid" }, symbol: "circle" },
        { type: "line", name: "Forecast", data: [130, 140, 150], lineStyle: { type: "dashed" }, symbol: "triangle" },
      ],
    },
  },
  alternateExample: {
    option: {
      series: {
        type: "pie",
        radius: ["45%", "70%"],
        data: [
          { name: "Container Apps", value: 51734 },
          { name: "Virtual Machines", value: 20136 },
        ],
      },
    },
    entityType: "service",
    selectionMode: "filter",
  },
  validate: validateEChartsSpec,
  summarize: summarizeEChartsSpec,
};
