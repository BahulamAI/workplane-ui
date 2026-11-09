import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, FunnelChart, BoxplotChart, HeatmapChart, ParallelChart, GaugeChart, RadarChart, CandlestickChart, TreemapChart, SunburstChart, TreeChart, SankeyChart, GraphChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent, ParallelComponent, RadarComponent, PolarComponent, MarkAreaComponent, MarkPointComponent, CalendarComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { validateChatChart, SAMPLE_CHART_TYPES, TARGET_CHART_TYPES, HIERARCHY_CHART_TYPES, NETWORK_CHART_TYPES, type ChatChartPresentation, type ChartSeries, type ChartPoint, type IntervalSeries, type SampleSeries, type BubbleSeries, type TargetSeries, type HeatmapSeries, type OhlcSeries, type IntervalItem, type HierarchyNode, type GraphSeries, type Density } from './contract.js';
echarts.use([BarChart, LineChart, PieChart, ScatterChart, FunnelChart, BoxplotChart, HeatmapChart, ParallelChart, GaugeChart, RadarChart, CandlestickChart, TreemapChart, SunburstChart, TreeChart, SankeyChart, GraphChart,
  GridComponent, LegendComponent, TooltipComponent, AriaComponent, ParallelComponent, RadarComponent, PolarComponent, MarkAreaComponent, MarkPointComponent, CalendarComponent, SVGRenderer]);
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
function pearson(a: number[], b: number[]): number {
  const meanA = a.reduce((sum, v) => sum + v, 0) / a.length;
  const meanB = b.reduce((sum, v) => sum + v, 0) / b.length;
  const cov = a.reduce((sum, v, k) => sum + (v - meanA) * (b[k]! - meanB), 0);
  const sdA = Math.sqrt(a.reduce((sum, v) => sum + (v - meanA) ** 2, 0));
  const sdB = Math.sqrt(b.reduce((sum, v) => sum + (v - meanB) ** 2, 0));
  return sdA === 0 || sdB === 0 ? 0 : cov / (sdA * sdB);
}
/** Blue (negative) – white (zero) – red (positive), for a value in [-1, 1]. */
function divergingColor(t: number): string {
  const clamped = Math.max(-1, Math.min(1, t));
  const mix = (from: number[], to: number[], f: number) => from.map((v, i) => Math.round(v + (to[i]! - v) * f));
  const [r, g, b] = clamped < 0 ? mix([255, 255, 255], [37, 99, 235], -clamped) : mix([255, 255, 255], [220, 38, 38], clamped);
  return `rgb(${r},${g},${b})`;
}
/** White (0) – `base` (1), for a nonnegative-magnitude heatmap value normalized to [0, 1]. */
function sequentialColor(t: number, base: number[]): string {
  const clamped = Math.max(0, Math.min(1, t));
  const [r, g, b] = base.map((v, i) => Math.round(255 + (v - 255) * clamped));
  return `rgb(${r},${g},${b})`;
}
function hexToRgb(hex: string): number[] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/**
 * Stable series-to-color assignment: the same series name always lands on
 * the same palette slot, regardless of how many other series are present
 * or what order they arrive in — unlike `color[i % color.length]`, where a
 * series's color silently shifts if a sibling is added, removed or
 * reordered between renders of what a reader expects to be "the same line".
 */
function colorForName(name: string, palette: string[]): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length]!;
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
function chartOptionImpl(payload: ChatChartPresentation, dark: boolean): echarts.EChartsCoreOption {
  const type = payload.chart_type;
  const text = dark ? '#e2e8f0' : '#334155';
  const grid = dark ? '#334155' : '#e2e8f0';
  // Accessibility flags are independent of `theme`: `high_contrast` reaches
  // every branch through this single computed palette/decal/motion set,
  // rather than needing each of the ~10 option-construction sites below to
  // know about `payload.accessibility` itself — including the branches that
  // bake a color straight into a data point rather than reading it back off
  // `option.color`, which a post-processing pass could never reach.
  const highContrast = !!payload.accessibility?.high_contrast || payload.theme === 'high_contrast';
  const patterns = highContrast || !!payload.accessibility?.patterns;
  const reducedMotion = payload.accessibility?.reduced_motion
    ?? (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const color = [...palettes[highContrast ? 'high_contrast' : (payload.theme || 'default')]];
  if (dark && highContrast) color[color.length - 1] = '#ffffff';
  // Raw samples ({name, values: number[]}) are a different shape entirely —
  // no `.points` — so they are handled before any of the point-shape logic
  // below ever looks at payload.series.
  if ((SAMPLE_CHART_TYPES as readonly string[]).includes(type)) {
    const samples = payload.series as SampleSeries[];
    const option: echarts.EChartsCoreOption = {
      animation: !reducedMotion,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: patterns } },
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
        return { name: s.name, type: 'line', smooth: true, symbol: 'none', lineStyle: { color: colorForName(s.name, color) },
          areaStyle: { color: colorForName(s.name, color), opacity: 0.15 }, data: xs.map((x, k) => [x, ys[k]]) };
      });
      return option;
    }
    if (type === 'ecdf') {
      option.xAxis = { type: 'value', name: payload.x_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.yAxis = { type: 'value', min: 0, max: 1, name: payload.y_label || 'Cumulative share', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.legend = { show: samples.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: samples.map(s => s.name) };
      option.series = samples.map((s, i) => {
        const sorted = [...s.values].sort((a, b) => a - b);
        return { name: s.name, type: 'line', step: 'start', symbol: 'none', lineStyle: { color: colorForName(s.name, color) },
          data: sorted.map((v, k) => [v, (k + 1) / sorted.length]) };
      });
      return option;
    }
    if (type === 'scatter_matrix') {
      // Validated: 2-6 equal-length columns, one row per observation across
      // all of them. An n×n grid of small scatter plots, one per column
      // pair; the diagonal is left empty with just the column's own name.
      const dims = samples, n = dims.length;
      const gap = 3, margin = 6;
      const cell = (100 - margin * 2 - gap * (n - 1)) / n;
      const grids: Record<string, unknown>[] = [];
      const xAxes: Record<string, unknown>[] = [];
      const yAxes: Record<string, unknown>[] = [];
      const cellSeries: Record<string, unknown>[] = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const idx = r * n + c;
        grids.push({ left: `${margin + c * (cell + gap)}%`, top: `${margin + r * (cell + gap)}%`, width: `${cell}%`, height: `${cell}%` });
        xAxes.push({ type: 'value', gridIndex: idx, show: r === n - 1, name: r === n - 1 ? dims[c]!.name : undefined,
          axisLabel: { color: text, fontSize: 9 }, axisLine: { lineStyle: { color: grid } }, splitLine: { show: false } });
        yAxes.push({ type: 'value', gridIndex: idx, show: c === 0, name: c === 0 ? dims[r]!.name : undefined,
          axisLabel: { color: text, fontSize: 9 }, axisLine: { lineStyle: { color: grid } }, splitLine: { show: false } });
        if (r !== c) cellSeries.push({ type: 'scatter', xAxisIndex: idx, yAxisIndex: idx, symbolSize: 4,
          itemStyle: { color: color[0], opacity: 0.6 }, data: dims[c]!.values.map((x, k) => [x, dims[r]!.values[k]]) });
      }
      option.grid = grids; option.xAxis = xAxes; option.yAxis = yAxes;
      option.legend = { show: false };
      option.series = cellSeries;
      return option;
    }
    if (type === 'correlation_matrix') {
      // Validated: 2-6 equal-length columns. The diagonal is always 1 (a
      // column's correlation with itself) without needing to compute it.
      const dims = samples, n = dims.length;
      const names = dims.map(d => d.name);
      const cells: Record<string, unknown>[] = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const r2 = r === c ? 1 : pearson(dims[r]!.values, dims[c]!.values);
        const rounded = Math.round(r2 * 100) / 100;
        cells.push({ value: [c, r, rounded], itemStyle: { color: divergingColor(rounded) } });
      }
      option.xAxis = { type: 'category', data: names, axisLabel: { color: text } };
      option.yAxis = { type: 'category', data: names, axisLabel: { color: text } };
      option.legend = { show: false };
      option.series = [{ type: 'heatmap', data: cells, label: { show: true, color: text } }];
      return option;
    }
    if (type === 'parallel_coordinates') {
      // Validated: 2-6 equal-length columns, one row per observation. Each
      // row becomes one line crossing every column's own axis.
      const dims = samples;
      const rows = dims[0]!.values.length;
      (option as Record<string, unknown>).parallelAxis = dims.map((d, i) => ({ dim: i, name: d.name,
        nameTextStyle: { color: text }, axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } }));
      (option as Record<string, unknown>).parallel = { left: 80, right: 60, top: 40, bottom: 40 };
      option.legend = { show: false };
      option.series = [{ type: 'parallel', lineStyle: { color: color[0], opacity: 0.35, width: 1 },
        data: Array.from({ length: rows }, (_, r) => dims.map(d => d.values[r])) }];
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
        itemStyle: { color: colorForName(s.name, color), opacity: type === 'strip_plot' ? 0.55 : 0.85 },
        data: s.values.map((v, k) => [i + jitter[k]!, v]) };
    });
    return option;
  }
  // Targets/status ({name, value, ...bounds}) are also a flat shape with no
  // `.points`, handled the same way as the sample types above.
  if ((TARGET_CHART_TYPES as readonly string[]).includes(type)) {
    const targets = payload.series as TargetSeries[];
    const n = targets.length;
    const option: echarts.EChartsCoreOption = {
      animation: !reducedMotion,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: patterns } },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
      legend: { show: false },
    };
    if (type === 'gauge') {
      option.series = targets.map((g, i) => ({
        type: 'gauge', center: [`${((i + 0.5) / n) * 100}%`, '58%'], radius: `${Math.min(42, 85 / n)}%`,
        min: g.min ?? 0, max: g.max ?? 100,
        progress: { show: true, width: 10 },
        axisLine: { lineStyle: { width: 10, color: [[1, colorForName(g.name, color)]] } },
        pointer: { show: true, length: '55%', itemStyle: { color: text } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
        title: { show: true, offsetCenter: [0, '70%'], color: text, fontSize: 12 },
        // A plain string template with the target spliced in at build time —
        // not a function, so it stays data-only all the way to the option.
        detail: { valueAnimation: false, offsetCenter: [0, '40%'], color: text, fontSize: 16,
          formatter: g.target !== undefined ? `{value} / ${g.target}` : '{value}' },
        data: [{ value: g.value, name: g.name }],
      }));
      return option;
    }
    if (type === 'progress') {
      option.xAxis = { type: 'value', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
      option.yAxis = { type: 'category', data: targets.map(p => p.name), axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
      option.series = targets.map((p, i) => {
        const max = p.max ?? 100;
        return { name: p.name, type: 'bar', barWidth: 14, itemStyle: { color: colorForName(p.name, color), borderRadius: 4 },
          data: targets.map((_, r) => (r === i ? p.value : null)),
          markArea: { silent: true, data: [[
            { xAxis: 0, yAxis: i - 0.35, itemStyle: { color: grid, opacity: 0.2 } },
            { xAxis: max, yAxis: i + 0.35 },
          ]] } };
      });
      return option;
    }
    // bullet: a value bar over qualitative background bands (markArea) with
    // an optional target tick (markPoint), both anchored to this bullet's
    // own row only via explicit xAxis/yAxis bounds.
    option.xAxis = { type: 'value', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
    option.yAxis = { type: 'category', data: targets.map(b => b.name), axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
    option.series = targets.flatMap((b, i) => {
      const min = b.min ?? 0, max = b.max ?? 100;
      const edges = [min, ...((b.bands && b.bands.length) ? b.bands : [max])];
      const markAreaData = edges.slice(0, -1).map((start, k) => ([
        { xAxis: start, yAxis: i - 0.3, itemStyle: { color: grid, opacity: 0.15 + 0.12 * k } },
        { xAxis: edges[k + 1]!, yAxis: i + 0.3 },
      ]));
      const markPointData = b.target !== undefined
        ? [{ xAxis: b.target, yAxis: i, symbol: 'rect', symbolSize: [3, 20], itemStyle: { color: text } }] : [];
      return [
        { name: `${b.name} base`, type: 'bar', stack: `bullet-${i}`, stackStrategy: 'all', barWidth: 10,
          itemStyle: { opacity: 0 }, data: targets.map((_, r) => (r === i ? min : null)), tooltip: { show: false }, silent: true },
        { name: b.name, type: 'bar', stack: `bullet-${i}`, stackStrategy: 'all', barWidth: 10,
          itemStyle: { color: colorForName(b.name, color) },
          data: targets.map((_, r) => (r === i ? b.value - min : null)),
          markArea: { silent: true, data: markAreaData },
          ...(markPointData.length ? { markPoint: { symbol: 'rect', symbolSize: [3, 20],
            itemStyle: { color: text }, data: markPointData } } : {}) },
      ];
    });
    return option;
  }
  if (type === 'heatmap') {
    // Validated to always be a single series of independent {x, y, value}
    // cells — the x/y categories come from the cells themselves, not a
    // shared axis built from every series the way other types compute it.
    const [grid0] = payload.series as HeatmapSeries[];
    const xs = [...new Set(grid0!.cells.map(c => c.x))];
    const ys = [...new Set(grid0!.cells.map(c => c.y))];
    const values = grid0!.cells.map(c => c.value);
    const hasNegative = values.some(v => v < 0);
    const largest = Math.max(...values.map(Math.abs));
    const base = hexToRgb(color[0]!);
    const option: echarts.EChartsCoreOption = {
      animation: !reducedMotion,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: patterns } },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
      legend: { show: false },
      xAxis: { type: 'category', data: xs, axisLabel: { color: text } },
      yAxis: { type: 'category', data: ys, axisLabel: { color: text } },
      series: [{ type: 'heatmap', label: { show: true, color: text }, data: grid0!.cells.map(c => ({
        value: [xs.indexOf(c.x), ys.indexOf(c.y), c.value],
        itemStyle: { color: hasNegative ? divergingColor(largest === 0 ? 0 : c.value / largest) : sequentialColor(largest === 0 ? 0 : c.value / largest, base) },
      })) }],
    };
    return option;
  }
  if (type === 'candlestick') {
    const ohlc = payload.series as OhlcSeries[];
    const cats = [...new Set(ohlc.flatMap(s => s.points.map(p => String(p.x))))];
    const up = color[0]!, down = color[1] ?? '#ef4444';
    const hasVolume = ohlc.some(s => s.points.some(p => p.volume !== undefined));
    const option: echarts.EChartsCoreOption = {
      animation: !reducedMotion,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: patterns } },
      tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
      legend: { show: ohlc.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: ohlc.map(s => s.name) },
      xAxis: { type: 'category', data: cats, axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } },
      yAxis: hasVolume
        ? [
            { type: 'value', name: payload.y_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } },
            { type: 'value', name: 'Volume', show: false },
          ]
        : { type: 'value', name: payload.y_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } },
    };
    option.series = ohlc.flatMap(s => {
      const points = cats.map(x => s.points.find(p => String(p.x) === x));
      const bars: Record<string, unknown>[] = [{
        name: s.name, type: 'candlestick',
        itemStyle: { color: up, color0: down, borderColor: up, borderColor0: down },
        data: points.map(p => (p ? [p.open, p.close, p.low, p.high] : null)),
      }];
      if (hasVolume) bars.push({
        name: `${s.name} volume`, type: 'bar', yAxisIndex: 1,
        data: points.map(p => (p && p.volume !== undefined
          ? { value: p.volume, itemStyle: { color: p.close >= p.open ? up : down, opacity: 0.4 } }
          : null)),
      });
      return bars;
    });
    return option;
  }
  if (type === 'gantt') {
    // Validated to always be the flat {name, low, high, group?} shape.
    const items = payload.series as IntervalItem[];
    const groups = [...new Set(items.map(it => it.group).filter((g): g is string => g !== undefined))];
    const colorFor = (it: IntervalItem) => colorForName(it.group ?? it.name, color);
    const option: echarts.EChartsCoreOption = {
      animation: !reducedMotion,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: patterns } },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
      legend: { show: groups.length > 0, type: 'scroll', bottom: 0, textStyle: { color: text }, data: groups },
      xAxis: { type: 'value', name: payload.x_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } },
      yAxis: { type: 'category', data: items.map(it => it.name), axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } },
    };
    option.series = items.flatMap((it, i): Record<string, unknown>[] => {
      // A zero-duration row is a milestone: a marker, not a bar.
      if (it.low === it.high) return [{ name: it.group ?? it.name, type: 'scatter', symbol: 'diamond',
        symbolSize: 14, itemStyle: { color: colorFor(it) }, data: [[it.low, i]] }];
      return [
        // Same invisible-base-plus-span trick used throughout this file.
        { name: `${it.name} base`, type: 'bar', stack: `gantt-${i}`, stackStrategy: 'all', barWidth: 14,
          itemStyle: { opacity: 0 }, data: items.map((_, r) => (r === i ? it.low : null)), tooltip: { show: false }, silent: true },
        { name: it.group ?? it.name, type: 'bar', stack: `gantt-${i}`, stackStrategy: 'all', barWidth: 14,
          itemStyle: { color: colorFor(it) }, data: items.map((_, r) => (r === i ? it.high - it.low : null)) },
      ];
    });
    return option;
  }
  if ((HIERARCHY_CHART_TYPES as readonly string[]).includes(type)) {
    // Validated recursive {name, value?, children?} nodes, passed straight
    // through: ECharts' own treemap/sunburst/tree data shape already
    // matches ours exactly, so there is nothing to transform.
    const nodes = payload.series as HierarchyNode[];
    const option: echarts.EChartsCoreOption = {
      animation: !reducedMotion,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: patterns } },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
      legend: { show: false },
    };
    if (type === 'treemap') {
      option.series = [{ type: 'treemap', data: nodes, label: { color: text },
        breadcrumb: { show: false }, itemStyle: { borderColor: dark ? '#0f172a' : '#ffffff' } }];
    } else if (type === 'sunburst') {
      option.series = [{ type: 'sunburst', data: nodes, label: { color: text },
        itemStyle: { borderColor: dark ? '#0f172a' : '#ffffff', borderWidth: 1 } }];
    } else {
      // tree: validated to be exactly one root.
      option.series = [{ type: 'tree', data: nodes, label: { color: text, position: 'top' },
        lineStyle: { color: grid }, itemStyle: { color: color[0] },
        leaves: { label: { position: 'right', color: text } }, initialTreeDepth: -1 }];
    }
    return option;
  }
  if ((NETWORK_CHART_TYPES as readonly string[]).includes(type)) {
    // Validated to be exactly one combined {nodes, links} graph.
    const g = payload.series[0] as GraphSeries;
    const nameOf = new Map(g.nodes.map(n => [n.id, n.name ?? n.id]));
    const option: echarts.EChartsCoreOption = {
      animation: !reducedMotion,
      backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true, decal: { show: patterns } },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
    };
    if (type === 'sankey') {
      option.legend = { show: false };
      option.series = [{ type: 'sankey', emphasis: { focus: 'adjacency' },
        data: g.nodes.map(n => ({ name: nameOf.get(n.id) })),
        links: g.links.map(l => ({ source: nameOf.get(l.source), target: nameOf.get(l.target), value: l.value })),
        label: { color: text }, lineStyle: { color: 'gradient', opacity: 0.4 },
        itemStyle: { color: color[0], borderColor: grid } }];
    } else {
      // graph (node-link, force-directed).
      const categories = [...new Set(g.nodes.map(n => n.category).filter((c): c is string => c !== undefined))];
      option.legend = { show: categories.length > 0, type: 'scroll', bottom: 0, textStyle: { color: text }, data: categories };
      option.series = [{ type: 'graph', layout: 'force', roam: true, label: { show: true, color: text },
        categories: categories.map(c => ({ name: c })),
        data: g.nodes.map(n => ({ name: nameOf.get(n.id), value: n.value,
          symbolSize: n.value !== undefined ? Math.max(8, Math.min(50, Math.sqrt(n.value) * 4)) : 20,
          ...(n.category !== undefined ? { category: categories.indexOf(n.category) } : { itemStyle: { color: color[0] } }) })),
        links: g.links.map(l => ({ source: nameOf.get(l.source), target: nameOf.get(l.target),
          lineStyle: { width: l.value !== undefined ? Math.max(1, Math.min(6, l.value)) : 1 } })),
        lineStyle: { color: grid, curveness: 0.1 },
        force: { repulsion: 100, edgeLength: 80 } }];
    }
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
    animation: !reducedMotion,
    backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
    aria: { enabled: true, decal: { show: patterns } },
    tooltip: { trigger: pie || funnel || type === 'scatter' || type === 'scatter_trend' || type === 'bubble' || type === 'waffle' || type === 'radar' || type === 'polar_bar' ? 'item' : 'axis', renderMode: 'richText', confine: true },
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
      return { name, type: 'scatter', symbol: 'rect', symbolSize: 16, itemStyle: { color: colorForName(name, color) }, data: cells };
    });
    return option;
  }
  if (type === 'bubble') {
    // Validated to always be the named multi-series wrapper.
    const bubbles = payload.series as BubbleSeries[];
    const allSizes = bubbles.flatMap(b => b.points.map(p => p.size));
    const minSize = Math.min(...allSizes), maxSize = Math.max(...allSizes);
    const minPx = 8, maxPx = 60;
    // Diameter scales with sqrt(size), so the *area* — what the eye actually
    // compares — is proportional to size, not the radius.
    const diameter = (size: number) => maxSize > minSize
      ? minPx + (maxPx - minPx) * Math.sqrt((size - minSize) / (maxSize - minSize))
      : (minPx + maxPx) / 2;
    option.xAxis = { type: 'value', name: payload.x_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
    option.yAxis = { type: 'value', name: payload.y_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
    option.legend = { show: bubbles.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: bubbles.map(b => b.name) };
    option.series = bubbles.map((b, i) => ({ name: b.name, type: 'scatter',
      itemStyle: { color: colorForName(b.name, color), opacity: 0.7 },
      data: b.points.map(p => ({ value: [p.x, p.y], symbolSize: diameter(p.size) })) }));
    return option;
  }
  if (type === 'radar') {
    // Reuses the same {name, points: {x, y}} shape as bar/line: x is the
    // indicator label, y the score. A series missing an indicator is 0
    // there — radar needs a value per indicator to draw a closed shape.
    (option as Record<string, unknown>).radar = { indicator: categories.map(name => ({ name })),
      axisName: { color: text }, splitLine: { lineStyle: { color: grid } }, axisLine: { lineStyle: { color: grid } },
      splitArea: { show: false } };
    option.legend = { show: series.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: series.map(s => s.name) };
    option.series = [{ type: 'radar', data: series.map(s => ({ name: s.name,
      value: categories.map(x => s.points.find(p => String(p.x) === x)?.y ?? 0),
      itemStyle: { color: colorForName(s.name, color) }, lineStyle: { color: colorForName(s.name, color) },
      areaStyle: { color: colorForName(s.name, color), opacity: 0.12 } })) }];
    return option;
  }
  if (type === 'polar_bar') {
    // Same category/value data as bar, laid out on angle/radius axes
    // instead of x/y — a circular bar chart for cyclical categories.
    (option as Record<string, unknown>).polar = {};
    (option as Record<string, unknown>).angleAxis = { type: 'category', data: categories,
      axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
    (option as Record<string, unknown>).radiusAxis = { type: 'value', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
    option.legend = { show: series.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: series.map(s => s.name) };
    option.series = series.map(s => ({ name: s.name, type: 'bar', coordinateSystem: 'polar',
      itemStyle: { color: colorForName(s.name, color) },
      data: categories.map(x => s.points.find(p => String(p.x) === x)?.y ?? null) }));
    return option;
  }
  if (type === 'calendar_heatmap') {
    // Validated to always be a single series; each point's x is an ISO
    // date string. Range is a lexicographic min/max — valid for YYYY-MM-DD.
    const s = series[0]!;
    const dates = s.points.map(p => String(p.x)).sort();
    const values = s.points.map(p => p.y);
    const largest = Math.max(...values.map(Math.abs));
    const hasNegative = values.some(v => v < 0);
    const base = hexToRgb(color[0]!);
    (option as Record<string, unknown>).calendar = { range: [dates[0], dates[dates.length - 1]],
      cellSize: ['auto', 16], itemStyle: { color: dark ? '#1e293b' : '#f1f5f9', borderColor: grid },
      dayLabel: { color: text }, monthLabel: { color: text }, yearLabel: { show: false } };
    option.legend = { show: false };
    // Colors are precomputed per cell (no visualMap registered), so each
    // datum is given as an object rather than a plain [date, value] pair.
    option.series = [{ type: 'heatmap', coordinateSystem: 'calendar',
      data: s.points.map(p => ({ value: [String(p.x), p.y],
        itemStyle: { color: hasNegative ? divergingColor(largest === 0 ? 0 : p.y / largest) : sequentialColor(largest === 0 ? 0 : p.y / largest, base) } })) }];
    return option;
  }
  const categoryAxis = { type: 'category', data: categories, name: sparkline ? undefined : payload.x_label,
    show: !sparkline, axisLabel: { show: !sparkline, color: text }, axisLine: { show: !sparkline, lineStyle: { color: grid } } };
  const valueAxis = { type: 'value', ...(percent ? { min: 0, max: 100 } : {}), name: sparkline ? undefined : payload.y_label, show: !sparkline,
    axisLabel: { show: !sparkline, color: text, ...(percent ? { formatter: '{value}%' } : {}) },
    splitLine: { show: !sparkline, lineStyle: { color: grid } } };
  option.xAxis = type === 'horizontal_bar' ? valueAxis : (type === 'scatter' || type === 'scatter_trend') ? { ...valueAxis, name: payload.x_label } : categoryAxis;
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
          lineStyle: { opacity: 0 }, areaStyle: { color: colorForName(b.name, color), opacity: 0.22 }, data: span,
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
          itemStyle: { color: colorForName(b.name, color), opacity: 0.6 }, data: span, tooltip: { show: false }, silent: true },
        { name: b.name, type: 'scatter', symbolSize: 10, itemStyle: { color: colorForName(b.name, color) }, data: center },
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
      { name: a.name, type: 'scatter', symbolSize: 12, itemStyle: { color: colorForName(a.name, color) }, data: va },
      { name: b.name, type: 'scatter', symbolSize: 12, itemStyle: { color: colorForName(b.name, color) }, data: vb },
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
  if (type === 'drawdown' || type === 'cumulative_return') {
    // Both are a running computation over the series in x order, reusing
    // the ordinary line/area shape — no new data model, just a transform.
    option.legend = { show: series.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text }, data: series.map(s => s.name) };
    option.yAxis = { ...valueAxis, axisLabel: { ...valueAxis.axisLabel, formatter: '{value}%' } };
    option.series = series.map(s => {
      const vals = categories.map(x => s.points.find(p => String(p.x) === x)?.y ?? null);
      let state = type === 'drawdown' ? -Infinity : 1; // running peak, or running growth factor
      const transformed = vals.map(v => {
        if (v === null) return null;
        if (type === 'drawdown') { state = Math.max(state, v); return state > 0 ? ((v - state) / state) * 100 : 0; }
        state *= 1 + v; return (state - 1) * 100;
      });
      return { name: s.name, type: 'line', lineStyle: { color: colorForName(s.name, color) },
        areaStyle: type === 'drawdown' ? { color: colorForName(s.name, color), opacity: 0.25 } : undefined,
        data: transformed };
    });
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
    type: type === 'scatter' || type === 'scatter_trend' ? 'scatter' : type.includes('bar') ? 'bar' : 'line',
    ...(type.startsWith('stacked_') ? { stack: 'total' } : {}),
    ...(type.includes('area') ? { areaStyle: { color: colorForName(s.name, color), opacity: 0.22 } } : {}),
    ...(type === 'step_line' ? { step: 'start' } : {}),
    // Dash pattern and symbol shape stay index-based: they exist precisely
    // so two lines are told apart without relying on color (WCAG 2.2 AA),
    // so cycling them is correct even though the color itself is now stable.
    itemStyle: { color: colorForName(s.name, color) },
    lineStyle: { type: ['solid', 'dashed', 'dotted'][i % 3], color: colorForName(s.name, color) },
    symbol: sparkline ? 'none' : ['circle', 'rect', 'triangle', 'diamond'][i % 4],
    data: (type === 'scatter' || type === 'scatter_trend') ? s.points.map((p, index) => [typeof p.x === 'number' ? p.x : index, p.y]) : data[i],
  }));
  if (type === 'scatter_trend') {
    // Ordinary least squares over every numeric-x point, pooled across all
    // series. Omitted (not degraded into a vertical or NaN line) when every
    // x is identical, since the slope is then undefined.
    const points = series.flatMap(s => s.points).filter((p): p is { x: number; y: number } => typeof p.x === 'number');
    if (points.length >= 2) {
      const n = points.length;
      const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
      const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
      const varX = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
      if (varX > 0) {
        const slope = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / varX;
        const intercept = meanY - slope * meanX;
        const xs = points.map(p => p.x);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        (option.series as Record<string, unknown>[]).push({ name: 'Trend', type: 'line', symbol: 'none',
          lineStyle: { type: 'dashed', color: text },
          data: [[minX, slope * minX + intercept], [maxX, slope * maxX + intercept]] });
      }
    }
  }
  return option;
}
const DENSITY_SCALE: Record<string, number> = { compact: 0.82, comfortable: 1, presentation: 1.25 };
const BASE_FONT_SIZE = 12;
/**
 * Density scales spacing and label size only — it never adds, removes or
 * reorders data. Applied as a post-process over the already-built option
 * (rather than threaded through every chart_type branch above) so every
 * branch is untouched when density is absent — the default, and every
 * payload before this feature existed.
 */
function applyDensity(option: echarts.EChartsCoreOption, density: Density | undefined): echarts.EChartsCoreOption {
  const scale = DENSITY_SCALE[density ?? 'comfortable']!;
  if (scale === 1) return option;
  const opt = option as Record<string, unknown>;
  const grid = opt.grid;
  if (grid && typeof grid === 'object' && !Array.isArray(grid)) {
    const g = grid as Record<string, unknown>;
    for (const key of ['left', 'right', 'top', 'bottom'] as const) {
      if (typeof g[key] === 'number') g[key] = Math.round((g[key] as number) * scale);
    }
  }
  const textStyle = opt.textStyle;
  if (textStyle && typeof textStyle === 'object') (textStyle as Record<string, unknown>).fontSize = Math.round(BASE_FONT_SIZE * scale);
  const legend = opt.legend;
  if (legend && typeof legend === 'object' && !Array.isArray(legend)) {
    const legendTextStyle = (legend as Record<string, unknown>).textStyle;
    if (legendTextStyle && typeof legendTextStyle === 'object') {
      (legendTextStyle as Record<string, unknown>).fontSize = Math.round(BASE_FONT_SIZE * scale);
    }
  }
  return option;
}
export function chartOption(payload: ChatChartPresentation, dark = false): echarts.EChartsCoreOption {
  return applyDensity(chartOptionImpl(payload, dark), payload.density);
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
