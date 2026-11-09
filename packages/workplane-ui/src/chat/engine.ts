import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { validateChatChart, type ChatChartPresentation, type ChartSeries, type ChartPoint } from './contract.js';
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
  const text = dark ? '#e2e8f0' : '#334155';
  const grid = dark ? '#334155' : '#e2e8f0';
  const color = [...palettes[payload.theme || 'default']];
  if (dark && payload.theme === 'high_contrast') color[color.length - 1] = '#ffffff';
  const option: echarts.EChartsCoreOption = {
    animation: !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    backgroundColor: 'transparent', color, textStyle: { color: text, fontFamily: 'system-ui, sans-serif' },
    aria: { enabled: true, decal: { show: payload.theme === 'high_contrast' } },
    tooltip: { trigger: pie || type === 'scatter' ? 'item' : 'axis', renderMode: 'richText', confine: true },
    legend: { show: pie || series.length > 1, type: 'scroll', bottom: 0, textStyle: { color: text } },
    grid: { left: 60, right: 24, top: 24, bottom: 65, containLabel: true },
  };
  if (pie) {
    const data = multi ? series.map(s => ({ name: s.name, value: s.points.reduce((sum, p) => sum + p.y, 0) }))
      : series[0]!.points.map(p => ({ name: String(p.x), value: p.y }));
    option.series = [{ type: 'pie', radius: type === 'donut' ? ['42%', '68%'] : '68%', data,
      label: { color: text }, top: 10, bottom: 25 }];
    return option;
  }
  const categoryAxis = { type: 'category', data: categories, name: payload.x_label, axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } };
  const valueAxis = { type: 'value', name: payload.y_label, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } };
  option.xAxis = type === 'horizontal_bar' ? valueAxis : type === 'scatter' ? { ...valueAxis, name: payload.x_label } : categoryAxis;
  option.yAxis = type === 'horizontal_bar' ? categoryAxis : valueAxis;
  option.series = series.map((s, i) => ({ name: s.name,
    type: type === 'scatter' ? 'scatter' : type.includes('bar') ? 'bar' : 'line',
    ...(type.startsWith('stacked_') ? { stack: 'total' } : {}),
    ...(type.includes('area') ? { areaStyle: { opacity: 0.22 } } : {}),
    lineStyle: { type: ['solid', 'dashed', 'dotted'][i % 3] }, symbol: ['circle', 'rect', 'triangle', 'diamond'][i % 4],
    data: type === 'scatter' ? s.points.map((p, index) => [typeof p.x === 'number' ? p.x : index, p.y])
      : categories.map(x => s.points.find(p => String(p.x) === x)?.y ?? null),
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
