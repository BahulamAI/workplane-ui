/** Portable, data-only chat chart contract. No React, DOM or execution code. */
export const CHART_CONTRACT_VERSION = 'workplane.chat-chart/1' as const;
export const CHART_TYPES = ['bar', 'horizontal_bar', 'lollipop', 'dumbbell', 'stacked_bar', 'stacked_bar_100', 'line', 'area', 'step_line', 'range_area', 'error_bar', 'stacked_area', 'stacked_area_100', 'sparkline', 'pie', 'donut', 'rose', 'pareto', 'waterfall', 'funnel', 'pyramid', 'waffle', 'scatter', 'bubble', 'scatter_trend', 'histogram', 'box_plot', 'density', 'ecdf', 'strip_plot', 'beeswarm', 'scatter_matrix', 'correlation_matrix', 'parallel_coordinates', 'radar', 'polar_bar', 'gauge', 'bullet', 'progress'] as const;
// Targets/status: a flat {name, value, ...bounds} item, not a {name, points}
// or {name, values} wrapper — there is only ever one measurement per name.
export const TARGET_CHART_TYPES = ['gauge', 'bullet', 'progress'] as const;
// These take raw numeric samples (not pre-aggregated label/value pairs); the
// renderer computes bins, quantiles, a density curve, or (for the last three)
// pairwise relationships across aligned columns, from them.
export const SAMPLE_CHART_TYPES = ['histogram', 'box_plot', 'density', 'ecdf', 'strip_plot', 'beeswarm', 'scatter_matrix', 'correlation_matrix', 'parallel_coordinates'] as const;
// scatter_matrix/correlation_matrix/parallel_coordinates treat each named
// sample as one column of an aligned table: every column needs the same
// number of rows (one observation per row), and a legible dimension count.
export const ALIGNED_SAMPLE_CHART_TYPES = ['scatter_matrix', 'correlation_matrix', 'parallel_coordinates'] as const;
export const CHART_THEMES = ['default', 'minimal', 'presentation', 'high_contrast'] as const;
export const chatChartHeight = (type: string): number => type === 'sparkline' ? 120 : 340;
export type ChartType = typeof CHART_TYPES[number];
export type ChartTheme = typeof CHART_THEMES[number];
export interface ChartPoint { label: string; value: number }
export interface ChartSeries { name: string; points: { x: string | number; y: number }[] }
export interface IntervalSeries { name: string; points: { x: string | number; low: number; high: number; value?: number }[] }
// Raw samples for histogram/box_plot/density/ecdf/strip_plot/beeswarm: the
// renderer, not the caller, computes bins, a five-number summary or a
// density curve, so the same reproducible transform always applies.
export interface SampleSeries { name: string; values: number[] }
// Used by bubble: a third nonnegative magnitude per point, encoded as area.
export interface BubbleSeries { name: string; points: { x: number; y: number; size: number }[] }
// Used by gauge/bullet/progress: one measurement per name, not a series of
// points — `bands` (ascending qualitative thresholds) only means anything
// for bullet; `target` means anything for gauge and bullet.
export interface TargetSeries { name: string; value: number; min?: number; max?: number; target?: number; bands?: number[] }
export interface ChatChartPresentation {
  schema_version: 'bahulam_render_v1'; type: 'chart';
  chart_type: ChartType; title?: string; x_label?: string; y_label?: string;
  series: ChartPoint[] | ChartSeries[] | IntervalSeries[] | SampleSeries[] | BubbleSeries[] | TargetSeries[]; observations?: string[];
  theme?: ChartTheme; appearance?: 'auto' | 'light' | 'dark';
  contract_version?: typeof CHART_CONTRACT_VERSION;
}
const text = { type: 'string', maxLength: 300 };
const point = { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: text, value: { type: 'number' } } };
const multi = { type: 'object', additionalProperties: false, required: ['name', 'points'], properties: {
  name: text, points: { type: 'array', minItems: 1, maxItems: 500, items: {
    type: 'object', additionalProperties: false, required: ['x', 'y'],
    properties: { x: { anyOf: [text, { type: 'number' }] }, y: { type: 'number' } },
  } },
} };
// Used by range_area (band) and error_bar (whisker): both need two bounds
// per x, not a single y. error_bar may also give the drawn point's own
// value, when it isn't the midpoint of low/high.
const rangeMulti = { type: 'object', additionalProperties: false, required: ['name', 'points'], properties: {
  name: text, points: { type: 'array', minItems: 1, maxItems: 500, items: {
    type: 'object', additionalProperties: false, required: ['x', 'low', 'high'],
    properties: { x: { anyOf: [text, { type: 'number' }] }, low: { type: 'number' }, high: { type: 'number' }, value: { type: 'number' } },
  } },
} };
// Used by histogram/box_plot/density/ecdf/strip_plot/beeswarm/scatter_matrix/
// correlation_matrix/parallel_coordinates: raw samples, not pre-aggregated
// points. The renderer computes bins/quantiles/density/pairwise relationships.
const sample = { type: 'object', additionalProperties: false, required: ['name', 'values'], properties: {
  name: text, values: { type: 'array', minItems: 1, maxItems: 2000, items: { type: 'number' } },
} };
// Used by bubble: x/y plus a nonnegative size, not just a single y.
const bubbleMulti = { type: 'object', additionalProperties: false, required: ['name', 'points'], properties: {
  name: text, points: { type: 'array', minItems: 1, maxItems: 500, items: {
    type: 'object', additionalProperties: false, required: ['x', 'y', 'size'],
    properties: { x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number', minimum: 0 } },
  } },
} };
// Used by gauge/bullet/progress: one flat measurement per name.
const targetItem = { type: 'object', additionalProperties: false, required: ['name', 'value'], properties: {
  name: text, value: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, target: { type: 'number' },
  bands: { type: 'array', maxItems: 5, items: { type: 'number' } },
} };
export const chartToolSchema = {
  type: 'object', additionalProperties: false, required: ['chart_type', 'series'], properties: {
    chart_type: { type: 'string', enum: CHART_TYPES }, title: text, x_label: text, y_label: text,
    series: { type: 'array', minItems: 1, maxItems: 500, items: { anyOf: [point, multi, rangeMulti, sample, bubbleMulti, targetItem] } },
    observations: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 1000 } },
    theme: { type: 'string', enum: CHART_THEMES }, appearance: { type: 'string', enum: ['auto', 'light', 'dark'] },
  },
  allOf: [{
    if: { properties: { chart_type: { not: { enum: ['range_area', 'error_bar', 'bubble', ...SAMPLE_CHART_TYPES, ...TARGET_CHART_TYPES] } } }, required: ['chart_type'] },
    then: { properties: { series: { items: { anyOf: [point, multi] } } } },
  }, {
    if: { properties: { chart_type: { const: 'bubble' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 12, items: bubbleMulti } } },
  }, {
    if: { properties: { chart_type: { enum: TARGET_CHART_TYPES } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 6, items: targetItem } } },
  }, {
    if: { properties: { chart_type: { enum: ALIGNED_SAMPLE_CHART_TYPES } }, required: ['chart_type'] },
    then: { properties: { series: { minItems: 2, maxItems: 6, items: sample } } },
  }, {
    if: { properties: { chart_type: { enum: ['stacked_bar_100', 'stacked_area_100', 'pareto', 'funnel', 'pyramid', 'rose', 'waffle'] } }, required: ['chart_type'] },
    then: { properties: { series: { items: { properties: {
      value: { minimum: 0 }, points: { items: { properties: { y: { minimum: 0 } } } },
    } } } } },
  }, {
    if: { properties: { chart_type: { enum: ['pareto', 'waterfall'] } }, required: ['chart_type'] },
    then: { properties: { series: { anyOf: [{ items: point }, { maxItems: 1, items: multi }] } } },
  }, {
    if: { properties: { chart_type: { enum: ['range_area', 'error_bar'] } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 12, items: rangeMulti } } },
  }, {
    if: { properties: { chart_type: { enum: SAMPLE_CHART_TYPES } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 12, items: sample } } },
  }, {
    if: { properties: { chart_type: { const: 'histogram' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 1 } } },
  }, {
    if: { properties: { chart_type: { const: 'dumbbell' } }, required: ['chart_type'] },
    then: { properties: { series: { minItems: 2, maxItems: 2, items: multi } } },
  }, {
    if: { properties: { chart_type: { const: 'lollipop' } }, required: ['chart_type'] },
    then: { properties: { series: { anyOf: [{ items: point }, { maxItems: 1, items: multi }] } } },
  }],
} as const;
export const chartCatalog = {
  contract_version: CHART_CONTRACT_VERSION,
  renderer: 'workplane.echarts.chat', themes: CHART_THEMES,
  presentations: [
    { types: ['bar', 'horizontal_bar'], purpose: 'Compare categories; use horizontal bars for long labels.', status: 'supported' },
    { types: ['lollipop'], purpose: 'Compare categories with a lighter visual weight than full bars; single series only.', status: 'supported' },
    { types: ['dumbbell'], purpose: 'Show the distance between exactly two measurements per category, e.g. before vs after or target vs actual; needs exactly two named series.', status: 'supported' },
    { types: ['line', 'area', 'step_line'], purpose: 'Show ordered trends; use area to emphasize magnitude, step for values that change in discrete jumps rather than continuously.', status: 'supported' },
    { types: ['range_area'], purpose: "Show an uncertainty band or min/max range around a trend; each series needs a low and high value per x, not a single y.", status: 'supported' },
    { types: ['stacked_bar', 'stacked_area'], purpose: 'Show how multiple nonnegative series contribute to a total.', status: 'supported' },
    { types: ['stacked_bar_100', 'stacked_area_100'], purpose: 'Show what share each nonnegative series contributes to a total, normalized to 100% so proportions are comparable across categories of different absolute size.', status: 'supported' },
    { types: ['sparkline'], purpose: 'Show a trend at a glance with no axes or legend; for inline/compact scanning, not precise reading.', status: 'supported' },
    { types: ['pie', 'donut'], purpose: 'Show nonnegative parts of a whole, preferably 2–6 categories.', status: 'supported' },
    { types: ['rose'], purpose: "Like pie, but each slice's radius scales with its value instead of just its angle, which emphasizes magnitude differences more strongly; nonnegative.", status: 'supported' },
    { types: ['pareto'], purpose: 'Rank nonnegative categories by contribution and overlay cumulative percentage to find the vital few; single series only.', status: 'supported' },
    { types: ['waterfall'], purpose: 'Show a running total through a sequence of signed increases and decreases; single series where each point is a delta from the previous total, not an absolute value.', status: 'supported' },
    { types: ['funnel', 'pyramid'], purpose: 'Show a nonnegative quantity narrowing (funnel) or widening (pyramid) through ordered stages.', status: 'supported' },
    { types: ['waffle'], purpose: 'Show nonnegative parts of a whole as a 10x10 grid of unit squares, one block per percentage point; best for one proportion at a glance, not precise multi-way comparison.', status: 'supported' },
    { types: ['error_bar'], purpose: 'Show a measurement plus its uncertainty range; like range_area but for a single point per x rather than a continuous band. Give low/high (and an explicit value if the drawn point is not their midpoint).', status: 'supported' },
    { types: ['scatter'], purpose: 'Show relationships between two numeric measurements; use numeric x/y points.', status: 'supported' },
    { types: ['bubble'], purpose: 'Like scatter, plus a third nonnegative magnitude encoded as point size (area-proportional, not radius-proportional, per perceptual accuracy); points need x, y and size.', status: 'supported' },
    { types: ['scatter_trend'], purpose: 'Scatter plus an overlaid ordinary-least-squares trend line fit to all points; the line is omitted only when every x value is identical.', status: 'supported' },
    { types: ['histogram'], purpose: 'Show the distribution of one sample of raw numeric observations, auto-binned into equal-width bins; single series only.', status: 'supported' },
    { types: ['box_plot'], purpose: 'Show the five-number summary (min, quartiles, max) of one or more named samples of raw observations, for comparing distributions across groups.', status: 'supported' },
    { types: ['density'], purpose: 'Show a smoothed estimate of the distribution shape of one or more named samples, as a continuous curve rather than discrete bins.', status: 'supported' },
    { types: ['ecdf'], purpose: 'Show what fraction of a sample falls at or below each value, as a nondecreasing step curve from 0 to 1; good for comparing whole distributions without binning.', status: 'supported' },
    { types: ['strip_plot'], purpose: 'Show every raw observation of one or more named samples as points along one lane per sample, with no binning or smoothing.', status: 'supported' },
    { types: ['beeswarm'], purpose: 'Like strip_plot, but spreads overlapping points sideways within local density bins so individual observations stay visible rather than stacking on top of each other.', status: 'supported' },
    { types: ['scatter_matrix'], purpose: 'Show pairwise scatter plots for 2-6 aligned numeric columns (each row is one observation across every column) in a grid; good for spotting which pairs of variables relate.', status: 'supported' },
    { types: ['correlation_matrix'], purpose: 'Show the pairwise Pearson correlation coefficient for 2-6 aligned numeric columns as a color-coded, labeled grid.', status: 'supported' },
    { types: ['parallel_coordinates'], purpose: 'Show each observation as a line crossing one axis per aligned numeric column (2-6), for spotting patterns across many dimensions at once.', status: 'supported' },
    { types: ['radar'], purpose: 'Show one or more named profiles scored across the same set of indicators (the x labels), one axis per indicator; a series missing an indicator counts as 0 there.', status: 'supported' },
    { types: ['polar_bar'], purpose: 'Like bar, but arranged around a circle (angle = category, radius = value); good for cyclical categories like hours of day or months of year.', status: 'supported' },
    { types: ['gauge'], purpose: "Show a single measurement against a min/max range (default 0-100), optionally with a target shown in the label; 1-6 named gauges per chart.", status: 'supported' },
    { types: ['bullet'], purpose: 'Show a measurement against a target and qualitative background bands (e.g. poor/satisfactory/good) within a min/max range; 1-6 named bullets per chart.', status: 'supported' },
    { types: ['progress'], purpose: 'Show one or more named values as a filled bar against a max (default 100); a lightweight progress/thermometer indicator, not a dial.', status: 'supported' },
  ],
  limits: { max_points: 2000, max_series: 12, max_bytes: 64000 },
  instructions: 'Use render_chart with computed values. Do not invent data. Use render_table for exact values and render_kpi_cards for headline numbers. No code, callbacks, remote URLs or executable specifications.',
};

export function validateChatChart(value: unknown): ChatChartPresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (p.schema_version !== 'bahulam_render_v1' || p.type !== 'chart' || !CHART_TYPES.includes(p.chart_type as ChartType)) return null;
  if (p.contract_version !== undefined && p.contract_version !== CHART_CONTRACT_VERSION) return null;
  const keys = new Set([...Object.keys(chartToolSchema.properties), 'schema_version', 'type', 'contract_version']);
  if (Object.keys(p).some(k => !keys.has(k))) return null;
  for (const key of ['title', 'x_label', 'y_label']) if (p[key] !== undefined && (typeof p[key] !== 'string' || p[key].length > 300)) return null;
  if (p.theme !== undefined && !CHART_THEMES.includes(p.theme as ChartTheme)) return null;
  if (p.appearance !== undefined && !['auto', 'light', 'dark'].includes(p.appearance as string)) return null;
  if (p.observations !== undefined && (!Array.isArray(p.observations) || p.observations.length > 6 || p.observations.some(x => typeof x !== 'string' || x.length > 1000))) return null;
  if (!Array.isArray(p.series) || !p.series.length || p.series.length > 500) return null;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const label = (s: unknown) => typeof s === 'string' && s.length <= 300;

  // Raw samples are a distinct shape ({name, values: number[]}), not the
  // {name, points} wrapper every other type uses, so they get their own path.
  if ((SAMPLE_CHART_TYPES as readonly string[]).includes(p.chart_type as string)) {
    // The aligned types (scatter_matrix/correlation_matrix/parallel_coordinates)
    // need a legible, bounded number of columns; the distribution types allow
    // up to 12 independent samples.
    const aligned = (ALIGNED_SAMPLE_CHART_TYPES as readonly string[]).includes(p.chart_type as string);
    if (p.series.length > (aligned ? 6 : 12)) return null;
    if (aligned && p.series.length < 2) return null;
    // A histogram bins exactly one sample; nothing else to compare it against.
    if (p.chart_type === 'histogram' && p.series.length !== 1) return null;
    let sampleCount = 0;
    let rowLength: number | undefined;
    for (const item of p.series) {
      if (!item || typeof item !== 'object') return null;
      if (!label((item as Record<string, unknown>).name) || Object.keys(item).some(k => !['name', 'values'].includes(k))) return null;
      const values = (item as Record<string, unknown>).values;
      if (!Array.isArray(values) || !values.length || values.length > 2000 || values.some(v => !finite(v))) return null;
      // Aligned columns are rows of the same table: every column needs the
      // same number of observations, or pairing row k across columns is
      // meaningless.
      if (aligned) {
        if (rowLength === undefined) rowLength = values.length;
        else if (values.length !== rowLength) return null;
      }
      sampleCount += values.length;
    }
    if (sampleCount > 2000) return null;
    try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
    return value as ChatChartPresentation;
  }

  // Bubble always needs the named multi-series wrapper: a point's size has
  // no meaning without a series to label it in the legend/tooltip.
  if (p.chart_type === 'bubble') {
    if (typeof p.series[0]?.name !== 'string' || p.series.length > 12) return null;
    let bubbleCount = 0;
    for (const item of p.series) {
      if (!item || typeof item !== 'object') return null;
      if (!label((item as Record<string, unknown>).name) || Object.keys(item).some(k => !['name', 'points'].includes(k))) return null;
      const points = (item as Record<string, unknown>).points;
      if (!Array.isArray(points) || !points.length || points.length > 500) return null;
      for (const q of points as Record<string, unknown>[]) {
        if (!q || Object.keys(q).some(k => !['x', 'y', 'size'].includes(k)) || !finite(q.x) || !finite(q.y) || !finite(q.size) || (q.size as number) < 0) return null;
        bubbleCount++;
      }
    }
    if (bubbleCount > 2000) return null;
    try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
    return value as ChatChartPresentation;
  }

  // Gauge/bullet/progress: one flat {name, value, ...bounds} item per named
  // target, never a {name, points} or {name, values} wrapper.
  if ((TARGET_CHART_TYPES as readonly string[]).includes(p.chart_type as string)) {
    if (p.series.length > 6) return null;
    for (const item of p.series) {
      if (!item || typeof item !== 'object') return null;
      const t = item as Record<string, unknown>;
      if (!label(t.name) || !finite(t.value) || Object.keys(t).some(k => !['name', 'value', 'min', 'max', 'target', 'bands'].includes(k))) return null;
      if (t.min !== undefined && !finite(t.min)) return null;
      if (t.max !== undefined && !finite(t.max)) return null;
      if (t.min !== undefined && t.max !== undefined && (t.min as number) >= (t.max as number)) return null;
      const min = typeof t.min === 'number' ? t.min : 0;
      const max = typeof t.max === 'number' ? t.max : 100;
      if ((t.value as number) < min || (t.value as number) > max) return null;
      if (t.target !== undefined && (!finite(t.target) || (t.target as number) < min || (t.target as number) > max)) return null;
      if (t.bands !== undefined) {
        if (!Array.isArray(t.bands) || !t.bands.length || t.bands.length > 5) return null;
        let prev = min;
        for (const edge of t.bands) {
          if (!finite(edge) || (edge as number) <= prev || (edge as number) > max) return null;
          prev = edge as number;
        }
      }
    }
    try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
    return value as ChatChartPresentation;
  }

  const isMulti = typeof p.series[0]?.name === 'string';
  if (isMulti && p.series.length > 12) return null;
  const percent = p.chart_type === 'stacked_bar_100' || p.chart_type === 'stacked_area_100';
  // Parts-of-a-whole semantics: a negative contribution has no meaning for a
  // percentage, a Pareto ranking, a funnel/pyramid stage, a rose slice, or a
  // waffle's unit squares.
  const nonnegative = percent || ['pareto', 'funnel', 'pyramid', 'rose', 'waffle'].includes(p.chart_type as string);
  // range_area's and error_bar's points carry low/high instead of y; both
  // are always the named multi-series wrapper, never {label, value}.
  const isInterval = p.chart_type === 'range_area' || p.chart_type === 'error_bar';
  if (isInterval && !isMulti) return null;
  // Dumbbell compares exactly two named series; lollipop is one series drawn
  // with a lighter weight, so a named-series lollipop can only be the one.
  if (p.chart_type === 'dumbbell' && (!isMulti || p.series.length !== 2)) return null;
  if (p.chart_type === 'lollipop' && isMulti && p.series.length !== 1) return null;
  // Pareto ranks one measure; waterfall is one sequence of deltas. Neither
  // compares named series the way stacked/dumbbell charts do.
  if ((p.chart_type === 'pareto' || p.chart_type === 'waterfall') && isMulti && p.series.length !== 1) return null;
  let count = 0;
  for (const item of p.series) {
    if (!item || typeof item !== 'object') return null;
    if (isMulti) {
      if (!label(item.name) || Object.keys(item).some(k => !['name', 'points'].includes(k)) || !Array.isArray(item.points) || !item.points.length || item.points.length > 500) return null;
      for (const q of item.points) {
        if (!q) return null;
        if (isInterval) {
          if (Object.keys(q).some(k => !['x', 'low', 'high', 'value'].includes(k)) || !(label(q.x) || finite(q.x)) || !finite(q.low) || !finite(q.high) || q.low > q.high || !finite(q.high - q.low)) return null;
          if (q.value !== undefined && (!finite(q.value) || q.value < q.low || q.value > q.high)) return null;
        } else {
          if (Object.keys(q).some(k => !['x', 'y'].includes(k)) || !(label(q.x) || finite(q.x)) || !finite(q.y)) return null;
          if (nonnegative && q.y < 0) return null;
          if ((p.chart_type === 'scatter' || p.chart_type === 'scatter_trend') && !finite(q.x)) return null;
        }
        count++;
      }
    } else {
      if (!label(item.label) || !finite(item.value) || Object.keys(item).some(k => !['label', 'value'].includes(k))) return null;
      if (nonnegative && item.value < 0) return null;
      count++;
    }
  }
  if (count > 2000) return null;
  try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
  return value as ChatChartPresentation;
}
