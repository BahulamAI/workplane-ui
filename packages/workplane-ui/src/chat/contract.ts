/** Portable, data-only chat chart contract. No React, DOM or execution code. */
export const CHART_CONTRACT_VERSION = 'workplane.chat-chart/1' as const;
export const CHART_TYPES = ['bar', 'horizontal_bar', 'lollipop', 'dumbbell', 'stacked_bar', 'stacked_bar_100', 'line', 'area', 'step_line', 'range_area', 'stacked_area', 'stacked_area_100', 'sparkline', 'pie', 'donut', 'scatter'] as const;
export const CHART_THEMES = ['default', 'minimal', 'presentation', 'high_contrast'] as const;
export const chatChartHeight = (type: string): number => type === 'sparkline' ? 120 : 340;
export type ChartType = typeof CHART_TYPES[number];
export type ChartTheme = typeof CHART_THEMES[number];
export interface ChartPoint { label: string; value: number }
export interface ChartSeries { name: string; points: { x: string | number; y: number }[] }
export interface IntervalSeries { name: string; points: { x: string | number; low: number; high: number }[] }
export interface ChatChartPresentation {
  schema_version: 'bahulam_render_v1'; type: 'chart';
  chart_type: ChartType; title?: string; x_label?: string; y_label?: string;
  series: ChartPoint[] | ChartSeries[] | IntervalSeries[]; observations?: string[];
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
// Used by range_area: a band needs two bounds per x, not a single y.
const rangeMulti = { type: 'object', additionalProperties: false, required: ['name', 'points'], properties: {
  name: text, points: { type: 'array', minItems: 1, maxItems: 500, items: {
    type: 'object', additionalProperties: false, required: ['x', 'low', 'high'],
    properties: { x: { anyOf: [text, { type: 'number' }] }, low: { type: 'number' }, high: { type: 'number' } },
  } },
} };
export const chartToolSchema = {
  type: 'object', additionalProperties: false, required: ['chart_type', 'series'], properties: {
    chart_type: { type: 'string', enum: CHART_TYPES }, title: text, x_label: text, y_label: text,
    series: { type: 'array', minItems: 1, maxItems: 500, items: { anyOf: [point, multi, rangeMulti] } },
    observations: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 1000 } },
    theme: { type: 'string', enum: CHART_THEMES }, appearance: { type: 'string', enum: ['auto', 'light', 'dark'] },
  },
  allOf: [{
    if: { properties: { chart_type: { enum: ['stacked_bar_100', 'stacked_area_100'] } }, required: ['chart_type'] },
    then: { properties: { series: { items: { properties: {
      value: { minimum: 0 }, points: { items: { properties: { y: { minimum: 0 } } } },
    } } } } },
  }, {
    if: { properties: { chart_type: { const: 'range_area' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 12, items: rangeMulti } } },
    else: { properties: { series: { items: { anyOf: [point, multi] } } } },
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
    { types: ['scatter'], purpose: 'Show relationships between two numeric measurements; use numeric x/y points.', status: 'supported' },
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
  const isMulti = typeof p.series[0]?.name === 'string';
  if (isMulti && p.series.length > 12) return null;
  const percent = p.chart_type === 'stacked_bar_100' || p.chart_type === 'stacked_area_100';
  // range_area's points carry low/high instead of y; it is always the named
  // multi-series wrapper, never the plain {label, value} shape.
  const isInterval = p.chart_type === 'range_area';
  if (isInterval && !isMulti) return null;
  // Dumbbell compares exactly two named series; lollipop is one series drawn
  // with a lighter weight, so a named-series lollipop can only be the one.
  if (p.chart_type === 'dumbbell' && (!isMulti || p.series.length !== 2)) return null;
  if (p.chart_type === 'lollipop' && isMulti && p.series.length !== 1) return null;
  let count = 0;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const label = (s: unknown) => typeof s === 'string' && s.length <= 300;
  for (const item of p.series) {
    if (!item || typeof item !== 'object') return null;
    if (isMulti) {
      if (!label(item.name) || Object.keys(item).some(k => !['name', 'points'].includes(k)) || !Array.isArray(item.points) || !item.points.length || item.points.length > 500) return null;
      for (const q of item.points) {
        if (!q) return null;
        if (isInterval) {
          if (Object.keys(q).some(k => !['x', 'low', 'high'].includes(k)) || !(label(q.x) || finite(q.x)) || !finite(q.low) || !finite(q.high) || q.low > q.high || !finite(q.high - q.low)) return null;
        } else {
          if (Object.keys(q).some(k => !['x', 'y'].includes(k)) || !(label(q.x) || finite(q.x)) || !finite(q.y)) return null;
          if (percent && q.y < 0) return null;
          if (p.chart_type === 'scatter' && !finite(q.x)) return null;
        }
        count++;
      }
    } else {
      if (!label(item.label) || !finite(item.value) || Object.keys(item).some(k => !['label', 'value'].includes(k))) return null;
      if (percent && item.value < 0) return null;
      count++;
    }
  }
  if (count > 2000) return null;
  try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
  return value as ChatChartPresentation;
}
