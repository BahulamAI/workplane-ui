/** Portable, data-only chat chart contract. No React, DOM or execution code. */
export const CHART_CONTRACT_VERSION = 'workplane.chat-chart/1' as const;
export const CHART_TYPES = ['bar', 'horizontal_bar', 'lollipop', 'dumbbell', 'stacked_bar', 'stacked_bar_100', 'line', 'area', 'step_line', 'range_area', 'error_bar', 'stacked_area', 'stacked_area_100', 'sparkline', 'pie', 'donut', 'rose', 'pareto', 'waterfall', 'funnel', 'pyramid', 'waffle', 'scatter', 'bubble', 'scatter_trend', 'histogram', 'box_plot', 'density', 'ecdf', 'strip_plot', 'beeswarm', 'scatter_matrix', 'correlation_matrix', 'parallel_coordinates', 'radar', 'polar_bar', 'gauge', 'bullet', 'progress', 'heatmap', 'calendar_heatmap', 'candlestick', 'drawdown', 'cumulative_return', 'gantt', 'treemap', 'sunburst', 'tree', 'sankey', 'graph'] as const;
// Hierarchy: a recursive {name, value?, children?} node, not a flat series —
// the whole point is nesting. tree additionally requires exactly one root
// (ECharts' tree series draws one rooted layout, unlike treemap/sunburst,
// which happily lay out several top-level nodes side by side).
export const HIERARCHY_CHART_TYPES = ['treemap', 'sunburst', 'tree'] as const;
// Flow/network: one combined {nodes, links} graph, not a per-category
// series — sankey needs a value per link (it sizes the flow width);
// graph (node-link) does not.
export const NETWORK_CHART_TYPES = ['sankey', 'graph'] as const;
// Targets/status: a flat {name, value, ...bounds} item, not a {name, points}
// or {name, values} wrapper — there is only ever one measurement per name.
export const TARGET_CHART_TYPES = ['gauge', 'bullet', 'progress'] as const;
// Visual style, scoped deliberately narrow: 'outlined' strips each series'
// own fill to a transparent center plus a colored border (and zeroes any
// area fill), which only has a safe, unambiguous meaning where fill is
// purely decorative. It is NOT offered for: pie/donut/rose/funnel/pyramid/
// waffle (fill is the only thing distinguishing adjacent slices/cells),
// heatmap/calendar_heatmap/correlation_matrix/treemap/sunburst (fill color
// *is* the data encoding — outlining would destroy the chart's meaning,
// exactly what the plan warns a style must never do), and every type with
// its own helper/invisible sub-series (dumbbell, range_area, error_bar,
// waterfall, gantt, bullet, ...) this generic transform was never verified
// against. The rest of the plan's twelve-option style system (glass,
// neumorphism, skeuomorphism, claymorphism, hand-drawn, ...) remains
// unimplemented for the reasons in chat-integration.md.
export const VISUAL_STYLES = ['flat', 'outlined'] as const;
export type VisualStyle = typeof VISUAL_STYLES[number];
export const OUTLINE_CHART_TYPES = ['bar', 'horizontal_bar', 'stacked_bar', 'stacked_bar_100',
  'line', 'area', 'step_line', 'stacked_area', 'stacked_area_100', 'scatter', 'scatter_trend', 'sparkline'] as const;
// Types with exactly one cartesian x/y axis pair (not a multi-grid, polar,
// calendar or hierarchy/network layout), where zoom/pan and a reference
// line both make sense and render the same way: `reference_lines` always
// draws against the value axis, which is unambiguous for all of these.
export const INTERACTIVE_CHART_TYPES = ['bar', 'horizontal_bar', 'lollipop', 'dumbbell', 'stacked_bar', 'stacked_bar_100',
  'line', 'area', 'step_line', 'range_area', 'error_bar', 'stacked_area', 'stacked_area_100', 'scatter', 'bubble', 'scatter_trend',
  'histogram', 'box_plot', 'density', 'ecdf', 'strip_plot', 'beeswarm', 'waterfall', 'pareto', 'candlestick',
  'drawdown', 'cumulative_return', 'gantt', 'bullet', 'progress'] as const;
// Sorting is unambiguous only where there is exactly one value per named
// item: the parts-of-a-whole family (always, since multi-series there is
// summed to one value per series already) and bar/horizontal_bar/lollipop
// when they are a single series (multi-series would mean sorting by which
// series' value?, which has no unambiguous answer). funnel/pyramid are
// deliberately excluded: ECharts' own `sort` on that series type already
// always value-orders them (descending for funnel, ascending for pyramid)
// to get the narrowing shape, so a second sort field would be redundant.
export const SORTABLE_CHART_TYPES = ['pie', 'donut', 'rose', 'waffle', 'bar', 'horizontal_bar', 'lollipop'] as const;
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
// Used by heatmap: two categorical keys plus a value per cell, independent
// of each other (unlike correlation_matrix, which derives its cells).
export interface HeatmapSeries { name: string; cells: { x: string; y: string; value: number }[] }
// Used by candlestick: one OHLC bar per x, with an optional traded volume.
export interface OhlcSeries { name: string; points: { x: string | number; open: number; high: number; low: number; close: number; volume?: number }[] }
// Used by gantt: one row per named task on a numeric timeline (not a date
// axis — the caller picks the unit, e.g. days since project start, and
// describes it with x_label). `low === high` renders as a milestone marker
// instead of a bar, so a pure timeline of events is just every row being one.
export interface IntervalItem { name: string; low: number; high: number; group?: string }
// Used by treemap/sunburst/tree: a leaf (no `children`) needs a `value` to
// be sized by; a branch's value is optional (ECharts sums its children).
export interface HierarchyNode { name: string; value?: number; children?: HierarchyNode[] }
// Used by sankey/graph: one combined graph per chart. `name` defaults to
// `id` for both node identity in links and the displayed label. sankey
// requires every link's `value` (it sizes the flow); graph does not.
export interface GraphSeries {
  name?: string;
  nodes: { id: string; name?: string; value?: number; category?: string }[];
  links: { source: string; target: string; value?: number }[];
}
// Density controls spacing, font/symbol size and label thresholds — never
// which data is shown. Independent of theme (palette) and appearance
// (light/dark), per the plan's "appearance is independent of data
// semantics": a theme string must not also carry spacing and a11y meaning.
export const DENSITIES = ['compact', 'comfortable', 'presentation'] as const;
export type Density = typeof DENSITIES[number];
// Each flag is independent of `theme`: `high_contrast` no longer requires
// picking the high_contrast theme, `patterns` (decal fills, for
// color-vision-safety) can be turned on with any palette, and
// `reduced_motion` can override the OS-level prefers-reduced-motion signal
// in either direction.
export interface AccessibilityOptions { high_contrast?: boolean; patterns?: boolean; reduced_motion?: boolean }
// A dashed horizontal (or vertical, for horizontal_bar) line at `value` on
// the value axis — a target, threshold or baseline to compare the data
// against, not data itself.
export interface ReferenceLine { value: number; label?: string }
export interface ChatChartPresentation {
  schema_version: 'bahulam_render_v1'; type: 'chart';
  chart_type: ChartType; title?: string; x_label?: string; y_label?: string;
  series: ChartPoint[] | ChartSeries[] | IntervalSeries[] | SampleSeries[] | BubbleSeries[] | TargetSeries[] | HeatmapSeries[] | OhlcSeries[] | IntervalItem[] | HierarchyNode[] | GraphSeries[]; observations?: string[];
  theme?: ChartTheme; appearance?: 'auto' | 'light' | 'dark';
  density?: Density; accessibility?: AccessibilityOptions; visual_style?: VisualStyle;
  sort?: 'asc' | 'desc'; reference_lines?: ReferenceLine[];
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
// Used by heatmap: two independent categorical keys plus a value per cell.
const heatmapMulti = { type: 'object', additionalProperties: false, required: ['name', 'cells'], properties: {
  name: text, cells: { type: 'array', minItems: 1, maxItems: 500, items: {
    type: 'object', additionalProperties: false, required: ['x', 'y', 'value'],
    properties: { x: text, y: text, value: { type: 'number' } },
  } },
} };
// Used by candlestick: one OHLC bar per x, with an optional traded volume.
const ohlcMulti = { type: 'object', additionalProperties: false, required: ['name', 'points'], properties: {
  name: text, points: { type: 'array', minItems: 1, maxItems: 500, items: {
    type: 'object', additionalProperties: false, required: ['x', 'open', 'high', 'low', 'close'],
    properties: { x: { anyOf: [text, { type: 'number' }] }, open: { type: 'number' }, high: { type: 'number' },
      low: { type: 'number' }, close: { type: 'number' }, volume: { type: 'number', minimum: 0 } },
  } },
} };
// Used by gantt: one flat {name, low, high, group?} row per task/event.
const intervalItem = { type: 'object', additionalProperties: false, required: ['name', 'low', 'high'], properties: {
  name: text, low: { type: 'number' }, high: { type: 'number' }, group: text,
} };
// Used by treemap/sunburst/tree. The real depth/count bounds live in the
// semantic validator (validateChatChart) — recursive bounds don't express
// cleanly as a plain JSON Schema hint without $ref, so this stays shallow.
const hierarchyNode = { type: 'object', additionalProperties: false, required: ['name'], properties: {
  name: text, value: { type: 'number', minimum: 0 }, children: { type: 'array', minItems: 1, items: {} },
} };
// Used by sankey/graph: one combined graph per chart.
const graphSeries = { type: 'object', additionalProperties: false, required: ['nodes', 'links'], properties: {
  name: text,
  nodes: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['id'], properties: {
    id: text, name: text, value: { type: 'number', minimum: 0 }, category: text,
  } } },
  links: { type: 'array', minItems: 1, maxItems: 300, items: { type: 'object', additionalProperties: false, required: ['source', 'target'], properties: {
    source: text, target: text, value: { type: 'number', minimum: 0 },
  } } },
} };
export const chartToolSchema = {
  type: 'object', additionalProperties: false, required: ['chart_type', 'series'], properties: {
    chart_type: { type: 'string', enum: CHART_TYPES }, title: text, x_label: text, y_label: text,
    series: { type: 'array', minItems: 1, maxItems: 500, items: { anyOf: [point, multi, rangeMulti, sample, bubbleMulti, targetItem, heatmapMulti, ohlcMulti, intervalItem, hierarchyNode, graphSeries] } },
    observations: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 1000 } },
    theme: { type: 'string', enum: CHART_THEMES }, appearance: { type: 'string', enum: ['auto', 'light', 'dark'] },
    density: { type: 'string', enum: DENSITIES },
    accessibility: { type: 'object', additionalProperties: false, properties: {
      high_contrast: { type: 'boolean' }, patterns: { type: 'boolean' }, reduced_motion: { type: 'boolean' },
    } },
    visual_style: { type: 'string', enum: VISUAL_STYLES },
    sort: { type: 'string', enum: ['asc', 'desc'] },
    reference_lines: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['value'], properties: {
      value: { type: 'number' }, label: text,
    } } },
  },
  allOf: [{
    if: { properties: { chart_type: { not: { enum: ['range_area', 'error_bar', 'bubble', 'heatmap', 'candlestick', 'gantt', ...SAMPLE_CHART_TYPES, ...TARGET_CHART_TYPES, ...HIERARCHY_CHART_TYPES, ...NETWORK_CHART_TYPES] } } }, required: ['chart_type'] },
    then: { properties: { series: { items: { anyOf: [point, multi] } } } },
  }, {
    if: { properties: { chart_type: { const: 'bubble' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 12, items: bubbleMulti } } },
  }, {
    if: { properties: { chart_type: { const: 'heatmap' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 1, items: heatmapMulti } } },
  }, {
    if: { properties: { chart_type: { const: 'candlestick' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 6, items: ohlcMulti } } },
  }, {
    if: { properties: { chart_type: { const: 'gantt' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 50, items: intervalItem } } },
  }, {
    if: { properties: { chart_type: { enum: HIERARCHY_CHART_TYPES } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 20, items: hierarchyNode } } },
  }, {
    if: { properties: { chart_type: { const: 'tree' } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 1 } } },
  }, {
    if: { properties: { chart_type: { enum: NETWORK_CHART_TYPES } }, required: ['chart_type'] },
    then: { properties: { series: { maxItems: 1, items: graphSeries } } },
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
  }, {
    if: { properties: { chart_type: { not: { enum: SORTABLE_CHART_TYPES } } }, required: ['chart_type'] },
    then: { properties: { sort: false } },
  }, {
    if: { properties: { chart_type: { not: { enum: INTERACTIVE_CHART_TYPES } } }, required: ['chart_type'] },
    then: { properties: { reference_lines: false } },
  }, {
    if: { properties: { chart_type: { not: { enum: OUTLINE_CHART_TYPES } }, visual_style: { const: 'outlined' } }, required: ['chart_type', 'visual_style'] },
    then: { properties: { visual_style: false } },
  }],
} as const;
export const chartCatalog = {
  contract_version: CHART_CONTRACT_VERSION,
  renderer: 'workplane.echarts.chat', themes: CHART_THEMES,
  aliases: { alluvial: 'sankey' },
  deferred_types: ['marimekko', 'violin', 'icicle', 'circle_packing', 'chord'],
  separate_renderer_families: ['Geography', 'Scientific/specialist'],
  presentations: [
    { types: ['bar', 'horizontal_bar'], purpose: 'Compare categories; use horizontal bars for long labels.', status: 'supported',
      unsuitable_for: 'A continuous trend over time — use line/area so order and spacing read correctly.',
      example: { chart_type: 'bar', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }] } },
    { types: ['lollipop'], purpose: 'Compare categories with a lighter visual weight than full bars; single series only.', status: 'supported',
      unsuitable_for: 'More than a handful of categories, or multiple series — the dot is easy to lose at high density and this type is single-series only.',
      example: { chart_type: 'lollipop', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }] } },
    { types: ['dumbbell'], purpose: 'Show the distance between exactly two measurements per category, e.g. before vs after or target vs actual; needs exactly two named series.', status: 'supported',
      unsuitable_for: 'More than two measurements per category — use grouped bar for that.',
      example: { chart_type: 'dumbbell', series: [{ name: 'Before', points: [{ x: 'Q1', y: 10 }] }, { name: 'After', points: [{ x: 'Q1', y: 16 }] }] } },
    { types: ['line', 'area', 'step_line'], purpose: 'Show ordered trends; use area to emphasize magnitude, step for values that change in discrete jumps rather than continuously.', status: 'supported',
      unsuitable_for: 'Unordered categories — the line implies a sequence; use bar instead.',
      example: { chart_type: 'line', series: [{ name: 'Revenue', points: [{ x: 'Jan', y: 100 }, { x: 'Feb', y: 120 }] }] } },
    { types: ['range_area'], purpose: "Show an uncertainty band or min/max range around a trend; each series needs a low and high value per x, not a single y.", status: 'supported',
      unsuitable_for: 'A single point estimate at one x — use error_bar for one measurement’s uncertainty instead of a continuous band.',
      example: { chart_type: 'range_area', series: [{ name: 'Forecast', points: [{ x: 'Jan', low: 90, high: 110 }, { x: 'Feb', low: 95, high: 125 }] }] } },
    { types: ['stacked_bar', 'stacked_area'], purpose: 'Show how multiple nonnegative series contribute to a total.', status: 'supported',
      unsuitable_for: 'Series that can be negative — stacking assumes nonnegative contributions, or the running total stops meaning "total".',
      example: { chart_type: 'stacked_bar', series: [{ name: 'Online', points: [{ x: 'Q1', y: 60 }] }, { name: 'Retail', points: [{ x: 'Q1', y: 40 }] }] } },
    { types: ['stacked_bar_100', 'stacked_area_100'], purpose: 'Show what share each nonnegative series contributes to a total, normalized to 100% so proportions are comparable across categories of different absolute size.', status: 'supported',
      unsuitable_for: 'Comparing absolute totals across categories — normalizing to 100% hides them; use plain stacked_bar/stacked_area for that.',
      example: { chart_type: 'stacked_bar_100', series: [{ name: 'Online', points: [{ x: 'Q1', y: 60 }] }, { name: 'Retail', points: [{ x: 'Q1', y: 40 }] }] } },
    { types: ['sparkline'], purpose: 'Show a trend at a glance with no axes or legend; for inline/compact scanning, not precise reading.', status: 'supported',
      unsuitable_for: 'Anywhere a reader needs to read an exact value — axes and legend are hidden by design.',
      example: { chart_type: 'sparkline', series: [{ label: 'Jan', value: 100 }, { label: 'Feb', value: 120 }] } },
    { types: ['pie', 'donut'], purpose: 'Show nonnegative parts of a whole, preferably 2–6 categories.', status: 'supported',
      unsuitable_for: 'More than ~8 slices, or comparing across several pies — switch to bar, where length is easier to compare than angle.',
      example: { chart_type: 'pie', series: [{ label: 'Chrome', value: 65 }, { label: 'Safari', value: 20 }, { label: 'Other', value: 15 }] } },
    { types: ['rose'], purpose: "Like pie, but each slice's radius scales with its value instead of just its angle, which emphasizes magnitude differences more strongly; nonnegative.", status: 'supported',
      unsuitable_for: 'Precise value comparison — radius scaling exaggerates differences more than angle alone; use bar if accuracy matters more than impact.',
      example: { chart_type: 'rose', series: [{ label: 'Chrome', value: 65 }, { label: 'Safari', value: 20 }] } },
    { types: ['pareto'], purpose: 'Rank nonnegative categories by contribution and overlay cumulative percentage to find the vital few; single series only.', status: 'supported',
      unsuitable_for: 'Multi-series comparison — it ranks exactly one measure, and the cumulative line only means something for one series.',
      example: { chart_type: 'pareto', series: [{ label: 'Shipping', value: 42 }, { label: 'Billing', value: 10 }, { label: 'Login', value: 3 }] } },
    { types: ['waterfall'], purpose: 'Show a running total through a sequence of signed increases and decreases; single series where each point is a delta from the previous total, not an absolute value.', status: 'supported',
      unsuitable_for: 'A static snapshot of values at one point in time — it specifically shows the running change from one period to the next.',
      example: { chart_type: 'waterfall', series: [{ label: 'Start', value: 100 }, { label: 'Gains', value: 30 }, { label: 'Losses', value: -10 }] } },
    { types: ['funnel', 'pyramid'], purpose: 'Show a nonnegative quantity narrowing (funnel) or widening (pyramid) through ordered stages.', status: 'supported',
      unsuitable_for: 'Data that doesn’t represent sequential stages of one process — use bar for unrelated nonnegative categories.',
      example: { chart_type: 'funnel', series: [{ label: 'Visited', value: 1000 }, { label: 'Signed up', value: 400 }, { label: 'Purchased', value: 120 }] } },
    { types: ['waffle'], purpose: 'Show nonnegative parts of a whole as a 10x10 grid of unit squares, one block per percentage point; best for one proportion at a glance, not precise multi-way comparison.', status: 'supported',
      unsuitable_for: 'Many categories or precise comparison — limited to the visual resolution of a 10x10 grid (100 squares).',
      example: { chart_type: 'waffle', series: [{ label: 'Complete', value: 72 }, { label: 'Remaining', value: 28 }] } },
    { types: ['error_bar'], purpose: 'Show a measurement plus its uncertainty range; like range_area but for a single point per x rather than a continuous band. Give low/high (and an explicit value if the drawn point is not their midpoint).', status: 'supported',
      unsuitable_for: 'A continuous band across many x positions — use range_area for that.',
      example: { chart_type: 'error_bar', series: [{ name: 'Measurement', points: [{ x: 'Trial 1', low: 8, high: 12, value: 10 }] }] } },
    { types: ['scatter'], purpose: 'Show relationships between two numeric measurements; use numeric x/y points.', status: 'supported',
      unsuitable_for: 'Categorical x — needs genuinely numeric x/y pairs, or the relationship being shown isn’t real.',
      example: { chart_type: 'scatter', series: [{ name: 'Sample', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 3 }] }] } },
    { types: ['bubble'], purpose: 'Like scatter, plus a third nonnegative magnitude encoded as point size (area-proportional, not radius-proportional, per perceptual accuracy); points need x, y and size.', status: 'supported',
      unsuitable_for: 'A third dimension that isn’t a true magnitude — size implies quantity, not category; use color/category for that instead.',
      example: { chart_type: 'bubble', series: [{ name: 'Markets', points: [{ x: 1, y: 2, size: 10 }, { x: 2, y: 3, size: 30 }] }] } },
    { types: ['scatter_trend'], purpose: 'Scatter plus an overlaid ordinary-least-squares trend line fit to all points; the line is omitted only when every x value is identical.', status: 'supported',
      unsuitable_for: 'Categorical or ordinal x, or fewer than two distinct x values — the regression needs genuinely numeric x with some spread.',
      example: { chart_type: 'scatter_trend', series: [{ name: 'Sample', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 5 }] }] } },
    { types: ['histogram'], purpose: 'Show the distribution of one sample of raw numeric observations, auto-binned into equal-width bins; single series only.', status: 'supported',
      unsuitable_for: 'Comparing multiple samples — it’s exactly one sample binned; use box_plot or density for that.',
      example: { chart_type: 'histogram', series: [{ name: 'Response times', values: [1.2, 1.5, 1.1, 2.3, 1.8, 1.4, 3.1] }] } },
    { types: ['box_plot'], purpose: 'Show the five-number summary (min, quartiles, max) of one or more named samples of raw observations, for comparing distributions across groups.', status: 'supported',
      unsuitable_for: 'Seeing the actual shape of a distribution — it only shows five summary numbers; pair it with density for that.',
      example: { chart_type: 'box_plot', series: [{ name: 'Control', values: [1, 2, 2, 3, 5, 8] }, { name: 'Treatment', values: [2, 3, 4, 4, 6, 9] }] } },
    { types: ['density'], purpose: 'Show a smoothed estimate of the distribution shape of one or more named samples, as a continuous curve rather than discrete bins.', status: 'supported',
      unsuitable_for: 'Very small samples — a KDE on a handful of points can look smoother and more confident than the data justifies.',
      example: { chart_type: 'density', series: [{ name: 'Control', values: [1, 2, 2, 3, 5, 8] }] } },
    { types: ['ecdf'], purpose: 'Show what fraction of a sample falls at or below each value, as a nondecreasing step curve from 0 to 1; good for comparing whole distributions without binning.', status: 'supported',
      unsuitable_for: 'An intuitive "typical value" read for a general audience — use box_plot or density for that.',
      example: { chart_type: 'ecdf', series: [{ name: 'Control', values: [1, 2, 2, 3, 5, 8] }] } },
    { types: ['strip_plot'], purpose: 'Show every raw observation of one or more named samples as points along one lane per sample, with no binning or smoothing.', status: 'supported',
      unsuitable_for: 'Large samples — points overlap with no way to tell how many are stacked; use beeswarm or histogram instead.',
      example: { chart_type: 'strip_plot', series: [{ name: 'Control', values: [1, 2, 2, 3, 5] }] } },
    { types: ['beeswarm'], purpose: 'Like strip_plot, but spreads overlapping points sideways within local density bins so individual observations stay visible rather than stacking on top of each other.', status: 'supported',
      unsuitable_for: 'Very large samples — hundreds of points still crowd a fixed-width lane even after spreading.',
      example: { chart_type: 'beeswarm', series: [{ name: 'Control', values: [1, 1, 2, 2, 2, 3, 5] }] } },
    { types: ['scatter_matrix'], purpose: 'Show pairwise scatter plots for 2-6 aligned numeric columns (each row is one observation across every column) in a grid; good for spotting which pairs of variables relate.', status: 'supported',
      unsuitable_for: 'More than ~6 columns — cells shrink past legibility; pick the most relevant columns instead.',
      example: { chart_type: 'scatter_matrix', series: [{ name: 'Height', values: [160, 170, 180] }, { name: 'Weight', values: [55, 65, 80] }] } },
    { types: ['correlation_matrix'], purpose: 'Show the pairwise Pearson correlation coefficient for 2-6 aligned numeric columns as a color-coded, labeled grid.', status: 'supported',
      unsuitable_for: 'Understanding the shape of a relationship — it collapses each pair to one number; pair it with scatter_matrix for the shape.',
      example: { chart_type: 'correlation_matrix', series: [{ name: 'Height', values: [160, 170, 180] }, { name: 'Weight', values: [55, 65, 80] }] } },
    { types: ['parallel_coordinates'], purpose: 'Show each observation as a line crossing one axis per aligned numeric column (2-6), for spotting patterns across many dimensions at once.', status: 'supported',
      unsuitable_for: 'More than a handful of columns or many overlapping rows — crossing lines become unreadable past that.',
      example: { chart_type: 'parallel_coordinates', series: [{ name: 'Speed', values: [80, 95] }, { name: 'Range', values: [300, 250] }] } },
    { types: ['radar'], purpose: 'Show one or more named profiles scored across the same set of indicators (the x labels), one axis per indicator; a series missing an indicator counts as 0 there.', status: 'supported',
      unsuitable_for: 'Indicators on very different scales without normalizing them first — the shape will mislead rather than inform.',
      example: { chart_type: 'radar', series: [{ name: 'Model A', points: [{ x: 'Speed', y: 8 }, { x: 'Comfort', y: 5 }] }] } },
    { types: ['polar_bar'], purpose: 'Like bar, but arranged around a circle (angle = category, radius = value); good for cyclical categories like hours of day or months of year.', status: 'supported',
      unsuitable_for: 'Precise value comparison — angular/radial position is harder to judge accurately than a linear bar’s length.',
      example: { chart_type: 'polar_bar', series: [{ name: 'Traffic', points: [{ x: 'Mon', y: 10 }, { x: 'Tue', y: 14 }] }] } },
    { types: ['gauge'], purpose: "Show a single measurement against a min/max range (default 0-100), optionally with a target shown in the label; 1-6 named gauges per chart.", status: 'supported',
      unsuitable_for: 'More than a handful of gauges at once, or a trend over time — it’s a single instantaneous reading, not a time series.',
      example: { chart_type: 'gauge', series: [{ name: 'CPU', value: 72, max: 100, target: 80 }] } },
    { types: ['bullet'], purpose: 'Show a measurement against a target and qualitative background bands (e.g. poor/satisfactory/good) within a min/max range; 1-6 named bullets per chart.', status: 'supported',
      unsuitable_for: 'More than a handful of bullets at once — legibility drops fast past that.',
      example: { chart_type: 'bullet', series: [{ name: 'Revenue', value: 72, min: 0, max: 100, target: 75, bands: [50, 80, 100] }] } },
    { types: ['progress'], purpose: 'Show one or more named values as a filled bar against a max (default 100); a lightweight progress/thermometer indicator, not a dial.', status: 'supported',
      unsuitable_for: 'A trend over time, or a value whose meaningful exceeding of max matters — it’s a single snapshot against a ceiling.',
      example: { chart_type: 'progress', series: [{ name: 'Setup', value: 40, max: 100 }] } },
    { types: ['heatmap'], purpose: 'Show a value for every combination of two independent categorical keys (e.g. a cohort/retention matrix) as a color-coded grid; single series of cells only.', status: 'supported',
      unsuitable_for: 'Sparse data — mostly-empty cells waste the grid; consider bar or scatter instead.',
      example: { chart_type: 'heatmap', series: [{ name: 'Retention', cells: [{ x: 'Week 1', y: 'Cohort A', value: 80 }, { x: 'Week 2', y: 'Cohort A', value: 55 }] }] } },
    { types: ['calendar_heatmap'], purpose: 'Show one value per day as a color-coded GitHub-style calendar grid; reuses the plain {label, value} shape with label as an ISO date (YYYY-MM-DD).', status: 'supported',
      unsuitable_for: 'More than roughly a year of days — cells become illegibly small past that.',
      example: { chart_type: 'calendar_heatmap', series: [{ label: '2026-01-01', value: 5 }, { label: '2026-01-02', value: 9 }] } },
    { types: ['candlestick'], purpose: 'Show open/high/low/close per period (e.g. trading day), optionally with a traded volume overlay on a second axis colored by up/down.', status: 'supported',
      unsuitable_for: 'Data that isn’t genuinely OHLC over ordered periods — a plain price series belongs on a line chart instead.',
      example: { chart_type: 'candlestick', series: [{ name: 'ACME', points: [{ x: '2026-01-01', open: 10, high: 12, low: 9, close: 11 }] }] } },
    { types: ['drawdown'], purpose: 'Show percentage decline from the running peak of a value series over time; reuses the line/area data shape, always nonpositive by construction.', status: 'supported',
      unsuitable_for: 'Values that already sum to 0 or alternate sign arbitrarily — built for a cumulative equity/price-style series with a meaningful running peak.',
      example: { chart_type: 'drawdown', series: [{ name: 'Equity', points: [{ x: 'Jan', y: 100 }, { x: 'Feb', y: 80 }, { x: 'Mar', y: 95 }] }] } },
    { types: ['cumulative_return'], purpose: 'Show compounded growth from a series of periodic returns (e.g. 0.02 for +2%), not price levels; reuses the line/area data shape.', status: 'supported',
      unsuitable_for: 'Price levels given directly — give periodic returns, not prices, or the compounding is computed on the wrong thing.',
      example: { chart_type: 'cumulative_return', series: [{ name: 'Strategy', points: [{ x: 'Jan', y: 0.1 }, { x: 'Feb', y: -0.05 }] }] } },
    { types: ['gantt'], purpose: 'Show tasks as horizontal bars spanning low-high on a numeric timeline (not a calendar date axis), one row per task; a row with low === high draws a milestone marker instead, so a plain timeline of events is just every row being one. Up to 50 rows; group optionally colors rows together.', status: 'supported',
      unsuitable_for: 'A calendar-dated schedule — the axis is a plain numeric timeline (e.g. days since start), not real dates.',
      example: { chart_type: 'gantt', series: [{ name: 'Design', low: 0, high: 5 }, { name: 'Kickoff', low: 0, high: 0 }] } },
    { types: ['treemap', 'sunburst'], purpose: 'Show a nested hierarchy (recursive {name, value?, children?} nodes; a leaf needs value, a branch sums its children) as nested rectangles (treemap) or nested rings (sunburst); several top-level nodes are fine.', status: 'supported',
      unsuitable_for: 'Negative values, or more than a few levels deep — labels become illegible past that.',
      example: { chart_type: 'treemap', series: [{ name: 'Engineering', children: [{ name: 'Backend', value: 30 }, { name: 'Frontend', value: 20 }] }] } },
    { types: ['tree'], purpose: 'Show a nested hierarchy as a rooted node-link layout (dendrogram); exactly one top-level root, since a rooted layout cannot draw several trees at once.', status: 'supported',
      unsuitable_for: 'More than one root, or a very deep/wide hierarchy — labels crowd fast.',
      example: { chart_type: 'tree', series: [{ name: 'Root', children: [{ name: 'Child A', value: 1 }, { name: 'Child B', value: 1 }] }] } },
    { types: ['sankey'], purpose: "Show weighted flow between stages as proportionally-sized ribbons; one combined {nodes, links} graph, every link needs a nonnegative value since it sizes the flow's width.", status: 'supported',
      unsuitable_for: 'A true network with cycles or bidirectional flow — sankey assumes a left-to-right staged flow.',
      example: { chart_type: 'sankey', series: [{ nodes: [{ id: 'visit' }, { id: 'signup' }], links: [{ source: 'visit', target: 'signup', value: 400 }] }] } },
    { types: ['graph'], purpose: 'Show a node-link network (force-directed layout); one combined {nodes, links} graph, link value is optional and only affects line width, not required the way sankey needs it.', status: 'supported',
      unsuitable_for: 'More than roughly 100 nodes — the force layout gets crowded and slow past that.',
      example: { chart_type: 'graph', series: [{ nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b' }] }] } },
  ],
  limits: { max_points: 2000, max_series: 12, max_bytes: 64000 },
  instructions: 'Use render_chart with computed values. Do not invent data. Use render_table for exact values and render_kpi_cards for headline numbers. No code, callbacks, remote URLs or executable specifications.',
  interactions: {
    zoom_pan: 'Scroll/pinch to zoom, drag to pan, double-click to reset — built into every chart whose type is in INTERACTIVE_CHART_TYPES; nothing to request.',
    legend_toggle: 'Click a legend entry to show/hide that series — built into every multi-series chart; nothing to request.',
    reference_lines: "Optional top-level reference_lines: [{value, label?}], up to 10, for chart types in INTERACTIVE_CHART_TYPES. Draws a dashed line across the value axis — a target or baseline to compare against, not data.",
    sort: "Optional top-level sort: 'asc'|'desc', for chart types in SORTABLE_CHART_TYPES. Reorders by value; omit it and the input order is kept exactly as given.",
    export: 'mountChatChart(...) returns svg() and png() for exporting the rendered chart; both are host-side JS calls, not part of the JSON payload.',
    visual_style: "Optional top-level visual_style: 'flat' (default) | 'outlined', for chart types in OUTLINE_CHART_TYPES only. 'outlined' strips each series' fill to a transparent center plus a colored border; unavailable for types where fill is the data encoding itself (pie/donut/heatmap/treemap/...) or that have their own helper sub-series this transform isn't verified against.",
    drill_down_and_cross_filtering: 'Not available from this portable, read-only contract — it requires a host-side data query or document commit, which an agent cannot embed as code. The Generative BI document surface has its own selection/query-bound interaction model for this; the chat contract does not share it.',
  },
};

export function validateChatChart(value: unknown): ChatChartPresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const label = (s: unknown) => typeof s === 'string' && s.length <= 300;
  if (p.schema_version !== 'bahulam_render_v1' || p.type !== 'chart' || !CHART_TYPES.includes(p.chart_type as ChartType)) return null;
  if (p.contract_version !== undefined && p.contract_version !== CHART_CONTRACT_VERSION) return null;
  const keys = new Set([...Object.keys(chartToolSchema.properties), 'schema_version', 'type', 'contract_version']);
  if (Object.keys(p).some(k => !keys.has(k))) return null;
  for (const key of ['title', 'x_label', 'y_label']) if (p[key] !== undefined && (typeof p[key] !== 'string' || p[key].length > 300)) return null;
  if (p.theme !== undefined && !CHART_THEMES.includes(p.theme as ChartTheme)) return null;
  if (p.appearance !== undefined && !['auto', 'light', 'dark'].includes(p.appearance as string)) return null;
  if (p.density !== undefined && !DENSITIES.includes(p.density as Density)) return null;
  if (p.accessibility !== undefined) {
    if (!p.accessibility || typeof p.accessibility !== 'object' || Array.isArray(p.accessibility)) return null;
    const a = p.accessibility as Record<string, unknown>;
    if (Object.keys(a).some(k => !['high_contrast', 'patterns', 'reduced_motion'].includes(k))) return null;
    for (const key of ['high_contrast', 'patterns', 'reduced_motion']) {
      if (a[key] !== undefined && typeof a[key] !== 'boolean') return null;
    }
  }
  // visual_style, sort and reference_lines are each meaningful only for a
  // bounded set of chart types (see the consts' own comments); reject them
  // elsewhere rather than silently ignoring a field the caller thought
  // would apply. 'flat' needs no check: every type renders that way already.
  if (p.visual_style !== undefined) {
    if (!(VISUAL_STYLES as readonly string[]).includes(p.visual_style as string)) return null;
    if (p.visual_style === 'outlined' && !(OUTLINE_CHART_TYPES as readonly string[]).includes(p.chart_type as string)) return null;
  }
  if (p.sort !== undefined) {
    if (!['asc', 'desc'].includes(p.sort as string)) return null;
    if (!(SORTABLE_CHART_TYPES as readonly string[]).includes(p.chart_type as string)) return null;
    // For bar/horizontal_bar/lollipop, sort is unambiguous only for a
    // single series — reject multi-series rather than silently ignoring
    // the field (the parts-of-a-whole types are always single-valued per
    // item regardless of shape, so they need no such check).
    const isNamedMulti = Array.isArray(p.series) && typeof (p.series[0] as Record<string, unknown> | undefined)?.name === 'string';
    if (['bar', 'horizontal_bar', 'lollipop'].includes(p.chart_type as string) && isNamedMulti && (p.series as unknown[]).length > 1) return null;
  }
  if (p.reference_lines !== undefined) {
    if (!(INTERACTIVE_CHART_TYPES as readonly string[]).includes(p.chart_type as string)) return null;
    if (!Array.isArray(p.reference_lines) || !p.reference_lines.length || p.reference_lines.length > 10) return null;
    for (const r of p.reference_lines) {
      if (!r || typeof r !== 'object') return null;
      const rl = r as Record<string, unknown>;
      if (Object.keys(rl).some(k => !['value', 'label'].includes(k))) return null;
      if (!finite(rl.value)) return null;
      if (rl.label !== undefined && !label(rl.label)) return null;
    }
  }
  if (p.observations !== undefined && (!Array.isArray(p.observations) || p.observations.length > 6 || p.observations.some(x => typeof x !== 'string' || x.length > 1000))) return null;
  if (!Array.isArray(p.series) || !p.series.length || p.series.length > 500) return null;

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

  // Heatmap is always a single series of independent {x, y, value} cells —
  // not aggregated per category the way other named-series types are.
  if (p.chart_type === 'heatmap') {
    if (typeof p.series[0]?.name !== 'string' || p.series.length !== 1) return null;
    const item = p.series[0] as Record<string, unknown>;
    if (!label(item.name) || Object.keys(item).some(k => !['name', 'cells'].includes(k))) return null;
    const cells = item.cells;
    if (!Array.isArray(cells) || !cells.length || cells.length > 500) return null;
    for (const c of cells as Record<string, unknown>[]) {
      if (!c || Object.keys(c).some(k => !['x', 'y', 'value'].includes(k)) || !label(c.x) || !label(c.y) || !finite(c.value)) return null;
    }
    try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
    return value as ChatChartPresentation;
  }

  // Calendar_heatmap reuses the plain point/multi shape, but its label is a
  // date the renderer places on a calendar — reject anything that isn't an
  // ISO YYYY-MM-DD string up front, rather than failing inside ECharts.
  if (p.chart_type === 'calendar_heatmap') {
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const dateOk = (s: unknown) => typeof s === 'string' && isoDate.test(s);
    const isMultiDate = typeof p.series[0]?.name === 'string';
    // A calendar has one range; rendering more than one named series would
    // mean silently dropping all but the first, so reject it up front.
    if (isMultiDate && p.series.length !== 1) return null;
    for (const item of p.series) {
      if (!item || typeof item !== 'object') return null;
      if (isMultiDate) {
        const points = (item as Record<string, unknown>).points;
        if (!Array.isArray(points) || points.some((q: unknown) => !dateOk((q as Record<string, unknown>)?.x))) return null;
      } else if (!dateOk((item as Record<string, unknown>).label)) return null;
    }
    // Fall through to the generic point/multi validation below for the rest
    // of the shape (value finiteness, size limits, and so on).
  }

  // Candlestick is always the named OHLC wrapper; low/high must actually
  // bound open/close, or the bar would misrepresent the traded range.
  if (p.chart_type === 'candlestick') {
    if (typeof p.series[0]?.name !== 'string' || p.series.length > 6) return null;
    let ohlcCount = 0;
    for (const item of p.series) {
      if (!item || typeof item !== 'object') return null;
      const s = item as Record<string, unknown>;
      if (!label(s.name) || Object.keys(s).some(k => !['name', 'points'].includes(k))) return null;
      const points = s.points;
      if (!Array.isArray(points) || !points.length || points.length > 500) return null;
      for (const q of points as Record<string, unknown>[]) {
        if (!q || Object.keys(q).some(k => !['x', 'open', 'high', 'low', 'close', 'volume'].includes(k))) return null;
        if (!(label(q.x) || finite(q.x)) || !finite(q.open) || !finite(q.high) || !finite(q.low) || !finite(q.close)) return null;
        if ((q.low as number) > Math.min(q.open as number, q.close as number)) return null;
        if ((q.high as number) < Math.max(q.open as number, q.close as number)) return null;
        if ((q.low as number) > (q.high as number)) return null;
        if (q.volume !== undefined && (!finite(q.volume) || (q.volume as number) < 0)) return null;
        ohlcCount++;
      }
    }
    if (ohlcCount > 2000) return null;
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

  // Gantt: one flat {name, low, high, group?} row per task, never a
  // {name, points} wrapper — a task has exactly one span on the timeline.
  if (p.chart_type === 'gantt') {
    if (p.series.length > 50) return null;
    for (const item of p.series) {
      if (!item || typeof item !== 'object') return null;
      const it = item as Record<string, unknown>;
      if (!label(it.name) || !finite(it.low) || !finite(it.high) || (it.low as number) > (it.high as number)) return null;
      if (Object.keys(it).some(k => !['name', 'low', 'high', 'group'].includes(k))) return null;
      if (it.group !== undefined && !label(it.group)) return null;
    }
    try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
    return value as ChatChartPresentation;
  }

  // Hierarchy: each top-level series item is itself a recursive node, not
  // a {name, points}/{name, values} wrapper. tree additionally needs
  // exactly one root (see the const's own comment above).
  if ((HIERARCHY_CHART_TYPES as readonly string[]).includes(p.chart_type as string)) {
    if (p.series.length > 20) return null;
    if (p.chart_type === 'tree' && p.series.length !== 1) return null;
    let nodeCount = 0;
    const validNode = (node: unknown, depth: number): boolean => {
      nodeCount++;
      if (nodeCount > 1000 || depth > 6 || !node || typeof node !== 'object') return false;
      const n = node as Record<string, unknown>;
      if (Object.keys(n).some(k => !['name', 'value', 'children'].includes(k))) return false;
      if (!label(n.name)) return false;
      if (n.value !== undefined && (!finite(n.value) || (n.value as number) < 0)) return false;
      if (n.children !== undefined) {
        if (!Array.isArray(n.children) || !n.children.length || n.children.length > 50) return false;
        return (n.children as unknown[]).every(c => validNode(c, depth + 1));
      }
      // A leaf with no children needs its own value to be sized by.
      return n.value !== undefined;
    };
    if (!p.series.every(n => validNode(n, 1))) return null;
    try { if (JSON.stringify(value).length > 64000) return null; } catch { return null; }
    return value as ChatChartPresentation;
  }

  // Flow/network: one combined {nodes, links} graph per chart, not a
  // per-category series.
  if ((NETWORK_CHART_TYPES as readonly string[]).includes(p.chart_type as string)) {
    if (p.series.length !== 1) return null;
    const g = p.series[0] as Record<string, unknown>;
    if (!g || typeof g !== 'object' || Object.keys(g).some(k => !['name', 'nodes', 'links'].includes(k))) return null;
    if (g.name !== undefined && !label(g.name)) return null;
    if (!Array.isArray(g.nodes) || !g.nodes.length || g.nodes.length > 100) return null;
    const ids = new Set<string>(), names = new Set<string>();
    for (const n of g.nodes) {
      if (!n || typeof n !== 'object') return null;
      const nd = n as Record<string, unknown>;
      if (Object.keys(nd).some(k => !['id', 'name', 'value', 'category'].includes(k))) return null;
      if (!label(nd.id) || ids.has(nd.id as string)) return null;
      ids.add(nd.id as string);
      if (nd.name !== undefined && !label(nd.name)) return null;
      // The effective display name (name, falling back to id) is what
      // identifies a node to ECharts; two nodes resolving to the same one
      // would silently merge in the rendered graph.
      const effective = typeof nd.name === 'string' ? nd.name : (nd.id as string);
      if (names.has(effective)) return null;
      names.add(effective);
      if (nd.value !== undefined && (!finite(nd.value) || (nd.value as number) < 0)) return null;
      if (nd.category !== undefined && !label(nd.category)) return null;
    }
    if (!Array.isArray(g.links) || !g.links.length || g.links.length > 300) return null;
    for (const l of g.links) {
      if (!l || typeof l !== 'object') return null;
      const ln = l as Record<string, unknown>;
      if (Object.keys(ln).some(k => !['source', 'target', 'value'].includes(k))) return null;
      if (!label(ln.source) || !ids.has(ln.source as string)) return null;
      if (!label(ln.target) || !ids.has(ln.target as string)) return null;
      // sankey sizes a flow's ribbon width by value; without one there is
      // nothing to draw. graph (node-link) has no such requirement.
      if (p.chart_type === 'sankey' && !finite(ln.value)) return null;
      if (ln.value !== undefined && (!finite(ln.value) || (ln.value as number) < 0)) return null;
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
