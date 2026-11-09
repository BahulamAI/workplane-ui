import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { validateChatChart, type ChatChartPresentation, type ChartSeries, type ChartPoint, type IntervalSeries } from './contract.js';
echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, SVGRenderer]);
const palettes = {
  default: ['#2563eb', '#059669', '#d97706', '#9333ea', '#e11d48', '#0891b2'],
  minimal: ['#475569', '#64748b', '#94a3b8', '#334155', '#0f766e', '#9a3412'],
  presentation: ['#7c3aed', '#0891b2', '#e11d48', '#d97706', '#059669', '#2563eb'],
  high_contrast: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#000000'],
};
export function chartOption(payload: ChatChartPresentation, dark = false): echarts.EChartsCoreOption {
  const multi = 'name' in payload.series[0]!;
  const series = multi ? payload.series as ChartSeries[] : [{ name: payload.title || 'Value', points: (payload.series as ChartPoint[]).map(p => ({ x: p.label, y: p.value })) }];
  const categories = [...new Set(series.flatMap(s => s.points.map(p => String(p.x))))];
  const type = payload.chart_type;
  const pie = type === 'pie' || type === 'donut';
  // The 100% variants reuse the stacked_* rendering below; only the values
  // they stack differ, so they are a data transform, not a new series shape.
  const percent = type === 'stacked_bar_100' || type === 'stacked_area_100';
  // Minimal trend indicator: same series as line/area, axes and legend hidden.
  const sparkline = type === 'sparkline';
  const text = dark ? '#e2e8f0' : '#334155';
  const grid = dark ? '#334155' : '#e2e8f0';
  const color = [...palettes[payload.theme || 'default']];
  if (dark && payload.theme === 'high_contrast') color[color.length - 1] = '#ffffff';
  const option: echarts.EChartsCoreOption = {
    animation: !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
    aria: { enabled: true, decal: { show: payload.theme === 'high_contrast' } },
    tooltip: { trigger: pie || type === 'scatter' ? 'item' : 'axis', renderMode: 'richText', confine: true },
    legend: { show: !sparkline && (pie || series.length > 1), type: 'scroll', bottom: 0, textStyle: { color: text } },
    grid: sparkline ? { left: 2, right: 2, top: 2, bottom: 2 } : { left: 60, right: 24, top: 24, bottom: 65, containLabel: true },
  };
  if (pie) {
    const data = multi ? series.map(s => ({ name: s.name, value: s.points.reduce((sum, p) => sum + p.y, 0) }))
      : series[0]!.points.map(p => ({ name: String(p.x), value: p.y }));
    option.series = [{ type: 'pie', radius: type === 'donut' ? ['42%', '68%'] : '68%', data,
      label: { color: text }, top: 10, bottom: 25 }];
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
