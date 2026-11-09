import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, FunnelChart, BoxplotChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { validateChatChart, SAMPLE_CHART_TYPES, type ChatChartPresentation, type ChartSeries, type ChartPoint, type IntervalSeries, type SampleSeries } from './contract.js';
echarts.use([BarChart, LineChart, PieChart, ScatterChart, FunnelChart, BoxplotChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, SVGRenderer]);
const palettes = {
  default: ['#2563eb', '#059669', '#d97706', '#9333ea', '#e11d48', '#0891b2'],
  minimal: ['#475569', '#64748b', '#94a3b8', '#334155', '#0f766e', '#9a3412'],
  presentation: ['#7c3aed', '#0891b2', '#e11d48', '#d97706', '#059669', '#2563eb'],
  high_contrast: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#000000'],
};
/**
 * Largest-remainder (Hamilton) apportionment: splits `squares` units across
 * `values` in exact proportion to each value's share of `total`, rounding so
 * the counts always sum to exactly `squares` rather than drifting from plain
 * per-value rounding. Deterministic; ties go to the earlier value.
 */
function allocateSquares(values: number[], total: number, squares: number): number[] {
  if (total <= 0) return values.map(() => 0);
  const raw = values.map(v => (v / total) * squares);
  const floors = raw.map(Math.floor);
  const remainders = raw.map((r, i) => ({ i, frac: r - floors[i]! })).sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  let used = floors.reduce((sum, f) => sum + f, 0);
  for (let k = 0; used < squares && k < remainders.length; k++, used++) result[remainders[k]!.i]!++;
  return result;
}
/** Linear-interpolation quantile (the common "type 7" definition). */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
/** Gaussian KDE with Silverman's rule-of-thumb bandwidth: deterministic and reproducible from the sample alone. */
function gaussianKde(values: number[], grid: number[]): number[] {
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, n - 1);
  const h = (1.06 * Math.sqrt(variance) * Math.pow(n, -1 / 5)) || 1;
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return grid.map(x => norm * values.reduce((sum, v) => sum + Math.exp(-0.5 * ((x - v) / h) ** 2), 0));
}
/**
 * Deterministic beeswarm jitter: bins values the same way the histogram
 * transform does, then spreads each bin's points symmetrically around the
 * lane center in input order. No randomness, no collision search.
 */
function beeswarmOffsets(values: number[], step = 0.06): number[] {
  const min = Math.min(...values), max = Math.max(...values);
  const bins = Math.max(1, Math.min(20, Math.ceil(Math.sqrt(values.length))));
  const width = max > min ? (max - min) / bins : 1;
  const binOf = (v: number) => (max > min ? Math.min(bins - 1, Math.floor((v - min) / width)) : 0);
  const binIndex = values.map(binOf);
  const counts = new Map<number, number>();
  for (const b of binIndex) counts.set(b, (counts.get(b) ?? 0) + 1);
  const seen = new Map<number, number>();
  return binIndex.map(b => {
    const k = seen.get(b) ?? 0;
    seen.set(b, k + 1);
    return (k - (counts.get(b)! - 1) / 2) * step;
  });
}
export function chartOption(payload: ChatChartPresentation, dark = false): echarts.EChartsCoreOption {
  const type = payload.chart_type;
  const text = dark ? '#e2e8f0' : '#334155';
  const grid = dark ? '#334155' : '#e2e8f0';
  const color = [...palettes[payload.theme || 'default']];
  if (dark && payload.theme === 'high_contrast') color[color.length - 1] = '#ffffff';
  // Raw samples ({name, values: number[]}) are a different shape entirely —
  // no `.points` — so they are handled before any of the point-shape logic
  // below ever looks at payload.series.
  if ((SAMPLE_CHART_TYPES as readonly string[]).includes(type)) {
    const samples = payload.series as SampleSeries[];
    const option: echarts.EChartsCoreOption = {
      animation: !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: payload.theme === 'high_contrast' } },
      tooltip: { trigger: type === 'strip_plot' || type === 'beeswarm' ? 'item' : 'axis', renderMode: 'richText', confine: true },
    };
    if (type === 'histogram') {
      // Validated to be exactly one series: one sample, auto-binned.
      const values = samples[0]!.values;
      const min = Math.min(...values), max = Math.max(...values);
      const bins = max > min ? 10 : 1;
      const width = max > min ? (max - min) / bins : 1;
      const counts = new Array(bins).fill(0) as number[];
      for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / width))]!++;
      const round = (n: number) => Math.round(n * 100) / 100;
      const labels = Array.from({ length: bins }, (_, i) => `${round(min + i * width)}–${round(min + (i + 1) * width)}`);
      option.xAxis = { type: 'category', data: labels, name: payload.x_label, axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
      option.yAxis = { type: 'value', name: payload.y_label || 'Count', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.legend = { show: false };
      option.series = [{ name: samples[0]!.name, type: 'bar', data: counts, itemStyle: { color: color[0] } }];
      return option;
    }
    if (type === 'box_plot') {
      const boxes = samples.map(s => {
        const sorted = [...s.values].sort((a, b) => a - b);
        return [sorted[0]!, quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75), sorted[sorted.length - 1]!];
      });
      option.xAxis = { type: 'category', data: samples.map(s => s.name), axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
      option.yAxis = { type: 'value', name: payload.y_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.legend = { show: false };
      option.series = [{ type: 'boxplot', data: boxes, itemStyle: { color: color[0], borderColor: text } }];
      return option;
    }
    if (type === 'density') {
      const all = samples.flatMap(s => s.values);
      const min = Math.min(...all), max = Math.max(...all);
      const pad = (max - min || 1) * 0.1;
      const gridPoints = 60;
      const xs = Array.from({ length: gridPoints }, (_, i) => min - pad + ((max - min + 2 * pad) * i) / (gridPoints - 1));
      option.xAxis = { type: 'value', name: payload.x_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.yAxis = { type: 'value', name: payload.y_label || 'Density', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.legend = { show: samples.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: samples.map(s => s.name) };
      option.series = samples.map((s, i) => {
        const ys = gaussianKde(s.values, xs);
        return { name: s.name, type: 'line', smooth: true, symbol: 'none', lineStyle: { color: color[i % color.length] },
          areaStyle: { color: color[i % color.length], opacity: 0.15 }, data: xs.map((x, k) => [x, ys[k]]) };
      });
      return option;
    }
    if (type === 'ecdf') {
      option.xAxis = { type: 'value', name: payload.x_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.yAxis = { type: 'value', min: 0, max: 1, name: payload.y_label || 'Cumulative share', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.legend = { show: samples.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: samples.map(s => s.name) };
      option.series = samples.map((s, i) => {
        const sorted = [...s.values].sort((a, b) => a - b);
        return { name: s.name, type: 'line', step: 'start', symbol: 'none', lineStyle: { color: color[i % color.length] },
          data: sorted.map((v, k) => [v, (k + 1) / sorted.length]) };
      });
      return option;
    }
    // strip_plot and beeswarm: one lane per named sample, raw points along
    // the value axis; beeswarm additionally spreads overlap sideways.
    option.xAxis = { type: 'category', data: samples.map(s => s.name), axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
    option.yAxis = { type: 'value', name: payload.y_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
    option.legend = { show: false };
    option.series = samples.map((s, i) => {
      const jitter = type === 'beeswarm' ? beeswarmOffsets(s.values) : s.values.map(() => 0);
      return { name: s.name, type: 'scatter', symbolSize: 8,
        itemStyle: { color: color[i % color.length], opacity: type === 'strip_plot' ? 0.55 : 0.85 },
        data: s.values.map((v, k) => [i + jitter[k]!, v]) };
    });
    return option;
  }
  const multi = 'name' in payload.series[0]!;
  const series = multi ? payload.series as ChartSeries[] : [{ name: payload.title || 'Value', points: (payload.series as ChartPoint[]).map(p => ({ x: p.label, y: p.value })) }];
  const categories = [...new Set(series.flatMap(s => s.points.map(p => String(p.x))))];
  const pie = type === 'pie' || type === 'donut' || type === 'rose';
  // Funnel/pyramid share the pie branch below: both are a single ranked set
  // of nonnegative name/value slices with no cartesian axes, differing only
  // in the native ECharts `sort` direction.
  const funnel = type === 'funnel' || type === 'pyramid';
  // The 100% variants reuse the stacked_* rendering below; only the values
  // they stack differ, so they are a data transform, not a new series shape.
  const percent = type === 'stacked_bar_100' || type === 'stacked_area_100';
  // Minimal trend indicator: same series as line/area, axes and legend hidden.
  const sparkline = type === 'sparkline';
  const option: echarts.EChartsCoreOption = {
    animation: !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
    aria: { enabled: true, decal: { show: payload.theme === 'high_contrast' } },
    tooltip: { trigger: pie || funnel || type === 'scatter' || type === 'waffle' ? 'item' : 'axis', renderMode: 'richText', confine: true },
    legend: { show: !sparkline && (pie || funnel || series.length > 1), type: 'scroll', bottom: 0, textStyle: { color: text } },
    grid: sparkline ? { left: 2, right: 2, top: 2, bottom: 2 } : { left: 60, right: 24, top: 24, bottom: 65, containLabel: true },
  };
  if (pie || funnel) {
    const data = multi ? series.map(s => ({ name: s.name, value: s.points.reduce((sum, p) => sum + p.y, 0) }))
      : series[0]!.points.map(p => ({ name: String(p.x), value: p.y }));
    option.series = funnel
      ? [{ type: 'funnel', sort: type === 'pyramid' ? 'ascending' : 'descending', data, label: { color: text },
          left: '10%', right: '10%', top: 10, bottom: 25,
          itemStyle: { borderColor: dark ? '#0f172a' : '#ffffff', borderWidth: 1 } }]
      : [{ type: 'pie', radius: type === 'donut' ? ['42%', '68%'] : '68%', ...(type === 'rose' ? { roseType: 'radius' } : {}),
          data, label: { color: text }, top: 10, bottom: 25 }];
    return option;
  }
  if (type === 'waffle') {
    // Reuses pie's own data extraction: one value per named series (summed
    // across its points) or one value per simple-shape point.
    const names = multi ? series.map(s => s.name) : series[0]!.points.map(p => String(p.x));
    const values = multi ? series.map(s => s.points.reduce((sum, p) => sum + p.y, 0)) : series[0]!.points.map(p => p.y);
    const total = values.reduce((sum, v) => sum + v, 0);
    const cols = 10, squares = 100;
    const counts = allocateSquares(values, total, squares);
    option.xAxis = { type: 'value', min: -0.5, max: cols - 0.5, show: false };
    option.yAxis = { type: 'value', min: -0.5, max: Math.ceil(squares / cols) - 0.5, show: false, inverse: true };
    option.grid = { left: 10, right: 10, top: 10, bottom: 40, containLabel: false };
    option.legend = { show: true, type: 'scroll', bottom: 0, textStyle: { color: text }, data: names };
    let cursor = 0;
    option.series = names.map((name, i) => {
      const cells: [number, number][] = [];
      for (let k = 0; k < counts[i]!; k++, cursor++) cells.push([cursor % cols, Math.floor(cursor / cols)]);
      return { name, type: 'scatter', symbol: 'rect', symbolSize: 16, itemStyle: { color: color[i % color.length] }, data: cells };
    });
    return option;
  }
  const categoryAxis = { type: 'category', data: categories, name: sparkline ? undefined : payload.x_label,
    show: !sparkline, axisLabel: { show: !sparkline, color: text }, axisLine: { show: !sparkline, lineStyle: { color: grid } } };
  const valueAxis = { type: 'value', ...(percent ? { min: 0, max: 100 } : {}), name: sparkline ? undefined : payload.y_label, show: !sparkline,
    axisLabel: { show: !sparkline, color: text, ...(percent ? { formatter: '{value}%' } : {}) },
    splitLine: { show: !sparkline, lineStyle: { color: grid } } };
  option.xAxis = type === 'horizontal_bar' ? valueAxis : type === 'scatter' ? { ...valueAxis, name: payload.x_label } : categoryAxis;
  option.yAxis = type === 'horizontal_bar' ? categoryAxis : valueAxis;
  // range_area, dumbbell and lollipop all share the axes/grid/tooltip set up
  // above; only their series need a different shape than bar/line/scatter.
  if (type === 'range_area') {
    const bands = payload.series as IntervalSeries[];
    option.legend = { show: bands.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: bands.map(b => b.name) };
    option.series = bands.flatMap((b, i) => {
      const points = categories.map(x => b.points.find(p => String(p.x) === x));
      const base = points.map((p, x) => [x, p?.low ?? null]);
      const span = points.map((p, x) => [x, p ? p.high - p.low : null, p?.low ?? null, p?.high ?? null]);
      return [
        // Invisible base holding the band's floor in place; stacking a
        // transparent area on top of it is how ECharts draws a min/max band
        // without a `custom` series, which would need a renderItem function.
        { name: `${b.name} (base)`, type: 'line', stack: `range-${i}`, stackStrategy: 'all', symbol: 'none',
          lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, data: base, encode: { x: 0, y: 1 }, tooltip: { show: false }, silent: true },
        { name: b.name, type: 'line', stack: `range-${i}`, stackStrategy: 'all', symbol: 'none',
          lineStyle: { opacity: 0 }, areaStyle: { color: color[i % color.length], opacity: 0.22 }, data: span,
          dimensions: ['Category', 'Span', 'Low', 'High'], encode: { x: 0, y: 1, tooltip: [2, 3] } },
      ];
    });
    return option;
  }
  if (type === 'error_bar') {
    const bars = payload.series as IntervalSeries[];
    option.legend = { show: bars.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: bars.map(b => b.name) };
    option.series = bars.flatMap((b, i) => {
      const points = categories.map(x => b.points.find(p => String(p.x) === x));
      const base = points.map(p => p?.low ?? null);
      const span = points.map(p => (p ? p.high - p.low : null));
      const center = points.map(p => (p ? p.value ?? (p.low + p.high) / 2 : null));
      return [
        // Same invisible-base-plus-band trick as range_area, but drawn as a
        // thin whisker (bar) rather than a filled area, plus a dot at the
        // measurement itself (the midpoint of low/high unless given).
        { name: `${b.name} (whisker base)`, type: 'bar', stack: `error-${i}`, stackStrategy: 'all', barWidth: 2,
          itemStyle: { opacity: 0 }, data: base, tooltip: { show: false }, silent: true },
        { name: `${b.name} (whisker)`, type: 'bar', stack: `error-${i}`, stackStrategy: 'all', barWidth: 2,
          itemStyle: { color: color[i % color.length], opacity: 0.6 }, data: span, tooltip: { show: false }, silent: true },
        { name: b.name, type: 'scatter', symbolSize: 10, itemStyle: { color: color[i % color.length] }, data: center },
      ];
    });
    return option;
  }
  if (type === 'dumbbell') {
    // Validated to be exactly two named series: what the dumbbell compares.
    const [a, b] = series as [ChartSeries, ChartSeries];
    const va = categories.map(x => a.points.find(p => String(p.x) === x)?.y ?? null);
    const vb = categories.map(x => b.points.find(p => String(p.x) === x)?.y ?? null);
    const low = va.map((v, i) => (v === null || vb[i] === null ? null : Math.min(v, vb[i]!)));
    const span = va.map((v, i) => (v === null || vb[i] === null ? null : Math.abs(vb[i]! - v)));
    option.legend = { show: true, type: 'scroll', bottom: 0, textStyle: { color: text }, data: [a.name, b.name] };
    option.series = [
      // The connecting stem: same invisible-base-plus-band trick as range_area.
      { name: 'stem-base', type: 'bar', stack: 'dumbbell', stackStrategy: 'all', barWidth: 2, itemStyle: { opacity: 0 }, data: low, tooltip: { show: false }, silent: true },
      { name: 'stem', type: 'bar', stack: 'dumbbell', stackStrategy: 'all', barWidth: 2, itemStyle: { color: grid, opacity: 0.8 }, data: span, tooltip: { show: false }, silent: true },
      { name: a.name, type: 'scatter', symbolSize: 12, itemStyle: { color: color[0] }, data: va },
      { name: b.name, type: 'scatter', symbolSize: 12, itemStyle: { color: color[1 % color.length] }, data: vb },
    ];
    return option;
  }
  if (type === 'lollipop') {
    // Validated to be exactly one series: the point it draws a stem to.
    const s = series[0]!;
    const values = categories.map(x => s.points.find(p => String(p.x) === x)?.y ?? null);
    option.series = [
      { name: s.name, type: 'bar', barWidth: 3, itemStyle: { color: color[0], opacity: 0.6 }, data: values, tooltip: { show: false }, silent: true },
      { name: s.name, type: 'scatter', symbolSize: 14, itemStyle: { color: color[0] }, data: values },
    ];
    return option;
  }
  if (type === 'waterfall') {
    // Validated to be exactly one series: a sequence of signed deltas from
    // the previous running total, in category order (not resorted).
    const s = series[0]!;
    const values = categories.map(x => s.points.find(p => String(p.x) === x)?.y ?? 0);
    let running = 0;
    const bars = values.map(delta => { const prev = running; running += delta; return { prev, delta }; });
    const base = bars.map(b => Math.min(b.prev, b.prev + b.delta));
    const span = bars.map(b => ({ value: Math.abs(b.delta),
      itemStyle: { color: b.delta >= 0 ? color[0] : (color[1] ?? color[0]) } }));
    option.legend = { show: false };
    option.series = [
      // Same invisible-base-plus-band trick as range_area/dumbbell, but the
      // base tracks the running total rather than a fixed low bound.
      { name: 'base', type: 'bar', stack: 'waterfall', stackStrategy: 'all', itemStyle: { opacity: 0 }, data: base, tooltip: { show: false }, silent: true },
      { name: s.name, type: 'bar', stack: 'waterfall', stackStrategy: 'all', data: span },
    ];
    return option;
  }
  if (type === 'pareto') {
    // Validated to be exactly one nonnegative series. A copy is sorted by
    // value; the input itself is never mutated or reordered.
    const s = series[0]!;
    const sorted = [...s.points].sort((a, b) => b.y - a.y);
    const total = sorted.reduce((sum, p) => sum + p.y, 0);
    let running = 0;
    const cumulative = sorted.map(p => { running += p.y; return total === 0 ? 0 : (running / total) * 100; });
    option.xAxis = { type: 'category', data: sorted.map(p => String(p.x)), name: payload.x_label,
      axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
    option.yAxis = [
      { type: 'value', name: payload.y_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } },
      { type: 'value', min: 0, max: 100, axisLabel: { color: text, formatter: '{value}%' }, splitLine: { show: false } },
    ];
    option.legend = { show: false };
    option.series = [
      { name: s.name, type: 'bar', data: sorted.map(p => p.y), itemStyle: { color: color[0] } },
      { name: 'Cumulative %', type: 'line', yAxisIndex: 1, data: cumulative, symbol: 'circle',
        lineStyle: { color: color[1 % color.length] } },
    ];
    return option;
  }
  // Aligned per category, same as the non-percent path; a category a series
  // has no point for stays `null` so it never counts as a zero contributor.
  const aligned = series.map(s => categories.map(x => s.points.find(p => String(p.x) === x)?.y ?? null));
  const data = percent
    ? aligned.map(values => values.map((v, xi) => {
        if (v === null) return null;
        // Scale first to avoid overflowing when several finite values are very large.
        const largest = Math.max(...aligned.map(row => row[xi] ?? 0));
        if (largest === 0) return 0;
        const total = aligned.reduce((sum, row) => sum + (row[xi] ?? 0) / largest, 0);
        return (v / largest / total) * 100;
      }))
    : aligned;
  option.series = series.map((s, i) => ({ name: s.name,
    type: type === 'scatter' ? 'scatter' : type.includes('bar') ? 'bar' : 'line',
    ...(type.startsWith('stacked_') ? { stack: 'total' } : {}),
    ...(type.includes('area') ? { areaStyle: { opacity: 0.22 } } : {}),
    ...(type === 'step_line' ? { step: 'start' } : {}),
    lineStyle: { type: ['solid', 'dashed', 'dotted'][i % 3] }, symbol: sparkline ? 'none' : ['circle', 'rect', 'triangle', 'diamond'][i % 4],
    data: type === 'scatter' ? s.points.map((p, index) => [typeof p.x === 'number' ? p.x : index, p.y]) : data[i],
  }));
  return option;
}
export function mountChatChart(container: HTMLElement, raw: unknown) {
  const payload = validateChatChart(raw);
  if (!payload) throw new Error('Unsupported or invalid chart presentation');
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const chart = echarts.init(container, undefined, { renderer: 'svg' });
  const draw = () => chart.setOption(chartOption(payload, payload.appearance === 'dark' || (payload.appearance !== 'light' && media.matches)), { notMerge: true });
  draw();
  const resize = new ResizeObserver(() => chart.resize()); resize.observe(container);
  media.addEventListener('change', draw);
  return { dispose() { resize.disconnect(); media.removeEventListener('change', draw); chart.dispose(); }, svg() { return chart.getDataURL({ type: 'svg' }); } };
}
