import type { KeyTree, SpecLimits } from "../core/index.js";

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
  series: { $array: SERIES },
  xAxis: { $array: AXIS },
  yAxis: { $array: AXIS },
  grid: { $array: { left: true, right: true, top: true, bottom: true, containLabel: true, show: true } },
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
