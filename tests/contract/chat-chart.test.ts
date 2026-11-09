import { describe, expect, it } from 'vitest';
import { chartCatalog, chartToolSchema, CHART_TYPES, SAMPLE_CHART_TYPES, ALIGNED_SAMPLE_CHART_TYPES, TARGET_CHART_TYPES, HIERARCHY_CHART_TYPES, NETWORK_CHART_TYPES, validateChatChart } from '../../packages/workplane-ui/src/chat/contract';
import { chartOption } from '../../packages/workplane-ui/src/chat/engine';
// Most types accept the plain {label, value} shape; a few need a shape that
// shows what makes them distinct (range_area/error_bar's bounds, dumbbell's
// exactly-two series, the sample types' raw values, bubble's size, the
// target types' flat {name, value}) to even validate.
const fixtureFor = (chart_type: string) =>
  (chart_type === 'range_area' || chart_type === 'error_bar') ? [{name:'one',points:[{x:'A',low:1,high:5}]}]
  : chart_type === 'dumbbell' ? [{name:'before',points:[{x:'A',y:1}]},{name:'after',points:[{x:'A',y:9}]}]
  : chart_type === 'bubble' ? [{name:'one',points:[{x:1,y:2,size:3}]}]
  : (ALIGNED_SAMPLE_CHART_TYPES as readonly string[]).includes(chart_type) ? [{name:'x',values:[1,2,3]},{name:'y',values:[4,5,6]}]
  : (SAMPLE_CHART_TYPES as readonly string[]).includes(chart_type) ? [{name:'one',values:[1,2,2,3,5,8]}]
  : (TARGET_CHART_TYPES as readonly string[]).includes(chart_type) ? [{name:'one',value:70,min:0,max:100,target:80,bands:[50,80,100]}]
  : chart_type === 'heatmap' ? [{name:'grid',cells:[{x:'A',y:'1',value:5}]}]
  : chart_type === 'calendar_heatmap' ? [{label:'2026-01-01',value:5},{label:'2026-01-02',value:9}]
  : chart_type === 'candlestick' ? [{name:'ACME',points:[{x:'2026-01-01',open:10,high:12,low:9,close:11}]}]
  : chart_type === 'gantt' ? [{name:'Design',low:0,high:5},{name:'Kickoff',low:0,high:0}]
  : (HIERARCHY_CHART_TYPES as readonly string[]).includes(chart_type) ? [{name:'root',children:[{name:'a',value:1},{name:'b',value:2}]}]
  : (NETWORK_CHART_TYPES as readonly string[]).includes(chart_type) ? [{nodes:[{id:'a'},{id:'b'}],links:[{source:'a',target:'b',value:1}]}]
  : [{label:'A',value:5},{label:'B',value:9}];
describe('portable chat chart contract', () => {
  for (const chart_type of CHART_TYPES) it(`renders ${chart_type} as a supported ECharts option`, () => {
    const chart = validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type,series:fixtureFor(chart_type)});
    expect(chart).not.toBeNull();
    const option = chartOption(chart!);
    expect(option.series).toBeTruthy();
    expect(JSON.stringify(option)).not.toContain('function');
  });
  it('advertises exactly the supported chart types', () => {
    expect(chartCatalog.presentations.flatMap(p=>p.types).sort()).toEqual([...CHART_TYPES].sort());
  });
  it('gives every presentation a working example and an unsuitable_for note', () => {
    for (const p of chartCatalog.presentations) {
      expect(p.example, p.types.join(',')).toBeDefined();
      expect(p.unsuitable_for?.length, p.types.join(',')).toBeGreaterThan(10);
      const chart = validateChatChart({ schema_version: 'bahulam_render_v1', type: 'chart', ...p.example });
      expect(chart, `${p.types.join(',')} example: ${JSON.stringify(p.example)}`).not.toBeNull();
      // The example's own chart_type must be one of the types it documents.
      expect(p.types).toContain(p.example?.chart_type);
    }
  });
  it('keeps the catalog affordable to send to an agent: a per-entry cap, and a total ceiling with room to grow', () => {
    // Mirrors the document catalog's own size-cap test (tests/contract/catalog.test.ts):
    // a per-entry cap is what actually stops bloat, since a flat total only
    // fails once, on whoever happens to add the last entry.
    const oversized = chartCatalog.presentations
      .map(p => [p.types.join(','), JSON.stringify(p).length] as const)
      .filter(([, bytes]) => bytes > 900);
    expect(oversized, `entries over 900 bytes: ${JSON.stringify(oversized)}`).toEqual([]);
    const total = JSON.stringify({ ...chartCatalog, tool_schema: chartToolSchema }).length;
    expect(total).toBeLessThan(45_000);
  });
  it('rejects bad shapes and unknown contract versions', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:2}]};
    expect(validateChatChart({...base,contract_version:'future'})).toBeNull();
    expect(validateChatChart({...base,series:[{label:'A',value:NaN}]})).toBeNull();
    expect(validateChatChart({...base,callback:'alert(1)'})).toBeNull();
  });
  it('aligns multi-series by category and leaves absent values missing', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'stacked_bar',series:[
      {name:'one',points:[{x:'A',y:5}]},{name:'two',points:[{x:'B',y:7}]}]});
    const option=chartOption(chart!);
    expect((option.series as any[])[0].data).toEqual([5,null]);
    expect((option.series as any[])[1].data).toEqual([null,7]);
  });
  it('normalizes 100% stacked bars to percentages of present series only, leaving missing values missing', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'stacked_bar_100',series:[
      {name:'one',points:[{x:'A',y:3},{x:'B',y:1}]},{name:'two',points:[{x:'A',y:1}]}]});
    const option=chartOption(chart!);
    // A: one=3, two=1 of a total of 4 -> 75%/25%. B: only "one" has a value,
    // so it is 100% of what is present rather than being diluted by a zero
    // that "two" never reported.
    expect((option.series as any[])[0].data).toEqual([75,100]);
    expect((option.series as any[])[1].data).toEqual([25,null]);
    expect((option.yAxis as any).axisLabel.formatter).toBe('{value}%');
  });
  it('marks step_line series as stepped', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'step_line',series:[{label:'A',value:1},{label:'B',value:2}]});
    const option=chartOption(chart!);
    expect((option.series as any[])[0].step).toBe('start');
  });
  it('hides axes and legend for sparklines', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'sparkline',series:[{label:'A',value:1},{label:'B',value:2}]});
    const option=chartOption(chart!);
    expect((option.xAxis as any).show).toBe(false);
    expect((option.yAxis as any).show).toBe(false);
    expect((option.legend as any).show).toBe(false);
  });
  it('rejects a range_area whose low exceeds its high, and anything but the interval shape', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'range_area'};
    expect(validateChatChart({...base,series:[{name:'band',points:[{x:'A',low:5,high:1}]}]})).toBeNull();
    expect(validateChatChart({...base,series:[{label:'A',value:1}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'band',points:[{x:'A',y:1}]}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'band',points:[{x:'A',low:1,high:5}]}]})).not.toBeNull();
  });
  it('draws a range_area band as a stacked, invisible-base line pair with no executable formatter', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'range_area',series:[
      {name:'band',points:[{x:'A',low:2,high:5},{x:'B',low:1,high:1}]}]});
    const option=chartOption(chart!);
    const series=option.series as any[];
    expect(series[0].data).toEqual([[0,2],[1,1]]); // category index + low
    expect(series[1].data).toEqual([[0,3,2,5],[1,0,1,1]]); // span plus original low/high for tooltip
    expect(series[1].encode.tooltip).toEqual([2,3]);
    expect(JSON.stringify(option)).not.toContain('function');
  });
  it('requires dumbbell to have exactly two named series', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'dumbbell'};
    expect(validateChatChart({...base,series:[{name:'only',points:[{x:'A',y:1}]}]})).toBeNull();
    expect(validateChatChart({...base,series:[{label:'A',value:1}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'a',points:[{x:'X',y:1}]},{name:'b',points:[{x:'X',y:2}]},{name:'c',points:[{x:'X',y:3}]}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'a',points:[{x:'X',y:1}]},{name:'b',points:[{x:'X',y:2}]}]})).not.toBeNull();
  });
  it('places a dot per dumbbell series and a connecting stem between them', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'dumbbell',series:[
      {name:'before',points:[{x:'A',y:3}]},{name:'after',points:[{x:'A',y:9}]}]});
    const option=chartOption(chart!);
    const series=option.series as any[];
    expect(series.find(s=>s.name==='before').data).toEqual([3]);
    expect(series.find(s=>s.name==='after').data).toEqual([9]);
    expect(series.find(s=>s.name==='stem').data).toEqual([6]); // |9-3|
  });
  it('requires lollipop to be a single series and draws a stem plus a dot', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'lollipop'};
    expect(validateChatChart({...base,series:[{name:'a',points:[{x:'X',y:1}]},{name:'b',points:[{x:'X',y:2}]}]})).toBeNull();
    const chart=validateChatChart({...base,series:[{label:'A',value:5},{label:'B',value:9}]});
    const option=chartOption(chart!);
    const series=option.series as any[];
    expect(series).toHaveLength(2);
    expect(series[0].type).toBe('bar');
    expect(series[1].type).toBe('scatter');
    expect(series[1].data).toEqual([5,9]);
  });
  it('rejects negative values and more than one series for pareto and waterfall where that applies', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pareto',series:[{label:'A',value:-1}]})).toBeNull();
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pareto',series:[{name:'a',points:[{x:'X',y:1}]},{name:'b',points:[{x:'X',y:2}]}]})).toBeNull();
    // Waterfall deltas may be negative (a decrease); only the series count is constrained.
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'waterfall',series:[{label:'A',value:-1}]})).not.toBeNull();
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'waterfall',series:[{name:'a',points:[{x:'X',y:1}]},{name:'b',points:[{x:'X',y:2}]}]})).toBeNull();
  });
  it('ranks pareto bars by value and overlays an exact cumulative percentage, without reordering the input', () => {
    const payload={schema_version:'bahulam_render_v1',type:'chart',chart_type:'pareto',series:[{label:'small',value:1},{label:'big',value:3}]};
    const before=JSON.stringify(payload);
    const chart=validateChatChart(payload)!;
    const option=chartOption(chart);
    expect((option.xAxis as any).data).toEqual(['big','small']); // sorted descending for display
    const series=option.series as any[];
    expect(series[0].data).toEqual([3,1]);
    expect(series[1].data).toEqual([75,100]);
    expect((option.yAxis as any[])[1].max).toBe(100);
    expect(JSON.stringify(payload)).toBe(before); // input order untouched
  });
  it('floats waterfall bars from the running total and colors increases and decreases differently', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'waterfall',series:[
      {label:'start',value:10},{label:'drop',value:-4},{label:'rise',value:6}]});
    const option=chartOption(chart!);
    const series=option.series as any[];
    expect(series[0].data).toEqual([0,6,6]); // base: running total before each delta (clamped to the lower edge)
    expect(series[1].data.map((d:any)=>d.value)).toEqual([10,4,6]);
    expect(series[1].data[1].itemStyle.color).not.toBe(series[1].data[0].itemStyle.color); // drop vs rise
  });
  it('rejects a negative funnel/pyramid value and draws a native funnel series sorted by direction', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'funnel',series:[{label:'A',value:-1}]})).toBeNull();
    const funnel=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'funnel',series:[{label:'A',value:5},{label:'B',value:2}]});
    expect((chartOption(funnel!).series as any[])[0]).toMatchObject({ type: 'funnel', sort: 'descending' });
    const pyramid=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pyramid',series:[{label:'A',value:5},{label:'B',value:2}]});
    expect((chartOption(pyramid!).series as any[])[0]).toMatchObject({ type: 'funnel', sort: 'ascending' });
  });
  it('rejects a negative rose value and draws a radius-scaled pie', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'rose',series:[{label:'A',value:-1}]})).toBeNull();
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'rose',series:[{label:'A',value:5},{label:'B',value:2}]});
    const series=(chartOption(chart!).series as any[])[0];
    expect(series).toMatchObject({ type: 'pie', roseType: 'radius' });
    expect(series.data).toEqual([{name:'A',value:5},{name:'B',value:2}]);
  });
  it('rejects a negative waffle value and allocates exactly 100 squares by largest remainder', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'waffle',series:[{label:'A',value:-1}]})).toBeNull();
    // 1/3, 1/3, 1/3 of 100 -> 33.33 each; largest-remainder gives one extra
    // square to the earliest ties so the three counts still sum to 100.
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'waffle',series:[
      {label:'A',value:1},{label:'B',value:1},{label:'C',value:1}]});
    const series=chartOption(chart!).series as any[];
    const counts=series.map(s=>s.data.length);
    expect(counts.reduce((a,b)=>a+b,0)).toBe(100);
    expect(counts).toEqual([34,33,33]);
    // Squares tile the 10-column grid with no gaps and no overlap.
    const allCells=series.flatMap(s=>s.data.map((c:number[])=>c.join(',')));
    expect(new Set(allCells).size).toBe(100);
  });
  it('rejects an error_bar value outside its own low/high and draws a whisker plus a centered dot', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'error_bar'};
    expect(validateChatChart({...base,series:[{name:'A',points:[{x:'X',low:2,high:10,value:15}]}]})).toBeNull();
    const explicit=validateChatChart({...base,series:[{name:'A',points:[{x:'X',low:2,high:10,value:3}]}]});
    const s1=chartOption(explicit!).series as any[];
    expect(s1[0].data).toEqual([2]); // whisker base = low
    expect(s1[1].data).toEqual([8]); // whisker span = high - low
    expect(s1[2].data).toEqual([3]); // the explicit value, not the midpoint
    const implicit=validateChatChart({...base,series:[{name:'A',points:[{x:'X',low:2,high:10}]}]});
    const s2=chartOption(implicit!).series as any[];
    expect(s2[2].data).toEqual([6]); // defaults to the midpoint when no value is given
  });
  it('requires histogram to be a single sample and bins it deterministically', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'histogram',
      series:[{name:'a',values:[1]},{name:'b',values:[2]}]})).toBeNull();
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'histogram',
      series:[{name:'sample',values:[1,1,2,2,2,3]}]});
    const option=chartOption(chart!);
    const counts=(option.series as any[])[0].data;
    expect(counts.length).toBe(10);
    expect(counts.reduce((a:number,b:number)=>a+b,0)).toBe(6);
    expect(counts[0]).toBe(2); // the two 1s
    expect(counts[5]).toBe(3); // the three 2s
    expect(counts[9]).toBe(1); // the one 3 (clamped into the last bin)
    expect((option.xAxis as any).data[0]).toBe('1–1.2');
  });
  it('computes a box_plot five-number summary per named sample with linear-interpolation quantiles', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'box_plot',series:[
      {name:'g',values:[1,2,3,4,5]},{name:'h',values:[10,20]}]});
    const option=chartOption(chart!);
    expect((option.xAxis as any).data).toEqual(['g','h']);
    expect((option.series as any[])[0].type).toBe('boxplot');
    expect((option.series as any[])[0].data).toEqual([[1,2,3,4,5],[10,12.5,15,17.5,20]]);
  });
  it('evaluates a density curve on a shared, padded grid without mutating the input', () => {
    const payload={schema_version:'bahulam_render_v1',type:'chart',chart_type:'density',series:[{name:'a',values:[1,2,3,4,5]}]};
    const before=JSON.stringify(payload);
    const chart=validateChatChart(payload)!;
    const option=chartOption(chart);
    const series=(option.series as any[])[0];
    expect(series.type).toBe('line');
    expect(series.data).toHaveLength(60);
    expect(series.data.every(([, y]:[number,number])=>y>=0)).toBe(true);
    expect(JSON.stringify(payload)).toBe(before);
  });
  it('builds an exact ECDF step curve from 0 to 1 without reordering the input', () => {
    const payload={schema_version:'bahulam_render_v1',type:'chart',chart_type:'ecdf',series:[{name:'a',values:[3,1,2]}]};
    const before=JSON.stringify(payload);
    const chart=validateChatChart(payload)!;
    const option=chartOption(chart);
    const series=(option.series as any[])[0];
    expect(series.step).toBe('start');
    expect(series.data).toEqual([[1,1/3],[2,2/3],[3,1]]);
    expect(JSON.stringify(payload)).toBe(before);
  });
  it('draws strip_plot points with no jitter, one lane per named sample', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'strip_plot',series:[
      {name:'A',values:[5,7]},{name:'B',values:[2]}]});
    const option=chartOption(chart!);
    const series=option.series as any[];
    expect(series[0].data).toEqual([[0,5],[0,7]]);
    expect(series[1].data).toEqual([[1,2]]);
  });
  it('spreads beeswarm points symmetrically around the lane center for colliding values', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'beeswarm',series:[
      {name:'A',values:[1,1,1]}]});
    const option=chartOption(chart!);
    const data=(option.series as any[])[0].data;
    expect(data.map((p:number[])=>p[1])).toEqual([1,1,1]); // the value itself never moves
    const offsets=data.map((p:number[])=>p[0]);
    expect(offsets[0]).toBeCloseTo(-0.06,5);
    expect(offsets[1]).toBeCloseTo(0,5);
    expect(offsets[2]).toBeCloseTo(0.06,5);
  });
  it('rejects a negative bubble size and scales diameter by sqrt(size) so area, not radius, is proportional', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bubble'};
    expect(validateChatChart({...base,series:[{name:'a',points:[{x:1,y:1,size:-1}]}]})).toBeNull();
    const chart=validateChatChart({...base,series:[{name:'a',points:[{x:1,y:1,size:1},{x:2,y:2,size:9}]}]});
    const data=(chartOption(chart!).series as any[])[0].data;
    expect(data[0].symbolSize).toBeCloseTo(8,5); // smallest size maps to the minimum diameter
    expect(data[1].symbolSize).toBeCloseTo(60,5); // largest size maps to the maximum diameter
  });
  it('fits an exact OLS trend line through scatter_trend points, and omits it when every x is identical', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'scatter_trend',series:[
      {name:'a',points:[{x:1,y:2},{x:2,y:4},{x:3,y:6}]}]}); // y = 2x exactly
    const trend=(chartOption(chart!).series as any[]).find(s=>s.name==='Trend');
    expect(trend.data).toEqual([[1,2],[3,6]]);
    const degenerate=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'scatter_trend',series:[
      {name:'a',points:[{x:5,y:1},{x:5,y:9}]}]});
    expect((chartOption(degenerate!).series as any[]).find(s=>s.name==='Trend')).toBeUndefined();
  });
  it('requires 2-6 equal-length columns for the aligned relationship types', () => {
    const tooFew={schema_version:'bahulam_render_v1',type:'chart',chart_type:'scatter_matrix',series:[{name:'x',values:[1,2]}]};
    expect(validateChatChart(tooFew)).toBeNull();
    const mismatched={schema_version:'bahulam_render_v1',type:'chart',chart_type:'correlation_matrix',series:[
      {name:'x',values:[1,2,3]},{name:'y',values:[1,2]}]};
    expect(validateChatChart(mismatched)).toBeNull();
  });
  it('lays out a scatter_matrix as an n×n grid of per-pair scatter cells, skipping the diagonal', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'scatter_matrix',series:[
      {name:'x',values:[1,2,3]},{name:'y',values:[4,5,6]}]});
    const option=chartOption(chart!);
    expect(option.grid).toHaveLength(4); // 2x2
    const series=option.series as any[];
    expect(series).toHaveLength(2); // off-diagonal cells only
    expect(series[0].data).toEqual([[4,1],[5,2],[6,3]]); // column y (x-axis) vs column x (y-axis)
  });
  it('computes an exact pairwise Pearson correlation_matrix with a diverging color per cell', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'correlation_matrix',series:[
      {name:'a',values:[1,2,3]},{name:'b',values:[3,2,1]}]}); // perfectly anti-correlated
    const cells=(chartOption(chart!).series as any[])[0].data;
    expect(cells[0].value).toEqual([0,0,1]); // a vs a: always 1
    expect(cells[1].value).toEqual([1,0,-1]); // a vs b: -1
    expect(cells[1].itemStyle.color).toBe('rgb(37,99,235)'); // fully blue at -1
    expect(cells[3].value).toEqual([1,1,1]); // b vs b: always 1
  });
  it('builds parallel_coordinates with one axis per column and one row per observation', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'parallel_coordinates',series:[
      {name:'a',values:[1,2]},{name:'b',values:[3,4]}]});
    const option=chartOption(chart!) as any;
    expect(option.parallelAxis).toHaveLength(2);
    expect(option.parallelAxis.map((a:any)=>a.name)).toEqual(['a','b']);
    expect(option.series[0].data).toEqual([[1,3],[2,4]]);
  });
  it('builds a radar from the same {name, points} shape as bar, defaulting a missing indicator to 0', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'radar',series:[
      {name:'Product A',points:[{x:'Speed',y:8},{x:'Comfort',y:5}]},{name:'Product B',points:[{x:'Speed',y:3}]}]});
    const option=chartOption(chart!) as any;
    expect(option.radar.indicator).toEqual([{name:'Speed'},{name:'Comfort'}]);
    expect(option.series[0].data).toEqual([
      {name:'Product A',value:[8,5],itemStyle:expect.anything(),lineStyle:expect.anything(),areaStyle:expect.anything()},
      {name:'Product B',value:[3,0],itemStyle:expect.anything(),lineStyle:expect.anything(),areaStyle:expect.anything()},
    ]);
  });
  it('lays out polar_bar on angle/radius axes with the same category/value data as bar', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'polar_bar',series:[
      {name:'s1',points:[{x:'Jan',y:5},{x:'Feb',y:9}]}]});
    const option=chartOption(chart!) as any;
    expect(option.angleAxis.data).toEqual(['Jan','Feb']);
    expect(option.series[0]).toMatchObject({ type: 'bar', coordinateSystem: 'polar', data: [5,9] });
  });
  it('rejects an out-of-range gauge value or target, and an inverted min/max', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'gauge'};
    expect(validateChatChart({...base,series:[{name:'CPU',value:150,max:100}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'CPU',value:70,max:100,target:150}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'CPU',value:70,min:100,max:0}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'CPU',value:70,max:100,target:80}]})).not.toBeNull();
  });
  it('renders a gauge with the target spliced into a plain string label, not a function', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'gauge',series:[
      {name:'CPU',value:70,max:100,target:80}]});
    const option=chartOption(chart!);
    const series=(option.series as any[])[0];
    expect(series.detail.formatter).toBe('{value} / 80');
    expect(series.data).toEqual([{value:70,name:'CPU'}]);
    expect(JSON.stringify(option)).not.toContain('function');
  });
  it('rejects bullet bands that are not ascending or that exceed max', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bullet'};
    expect(validateChatChart({...base,series:[{name:'A',value:10,max:100,bands:[80,50,100]}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'A',value:10,max:100,bands:[50,80,150]}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'A',value:10,max:100,bands:[50,80,100]}]})).not.toBeNull();
  });
  it('draws a bullet as a base+value stack with qualitative bands and a target tick, scoped to its own row', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bullet',series:[
      {name:'Revenue',value:72,min:0,max:100,target:75,bands:[50,80,100]}]});
    const option=chartOption(chart!);
    const series=option.series as any[];
    expect(series).toHaveLength(2); // invisible base + visible value, one bullet
    expect(series[0].data).toEqual([0]); // base = min
    expect(series[1].data).toEqual([72]); // value - min
    expect(series[1].markArea.data).toHaveLength(3); // three band segments
    expect(series[1].markArea.data[1][0].xAxis).toBe(50);
    expect(series[1].markArea.data[1][1].xAxis).toBe(80);
    expect(series[1].markPoint.data[0].xAxis).toBe(75);
  });
  it('draws progress as a single bar per named item with a full-range background track', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'progress',series:[
      {name:'Task',value:40,max:80}]});
    const option=chartOption(chart!);
    const series=(option.series as any[])[0];
    expect(series.data).toEqual([40]);
    expect(series.markArea.data[0][1].xAxis).toBe(80);
  });
  it('places heatmap cells by their own x/y categories and colors by sign, single series only', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'heatmap',series:[
      {name:'a',cells:[{x:'A',y:'1',value:1}]},{name:'b',cells:[{x:'A',y:'1',value:1}]}]})).toBeNull();
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'heatmap',series:[
      {name:'grid',cells:[{x:'A',y:'1',value:2},{x:'B',y:'1',value:8},{x:'A',y:'2',value:-4}]}]});
    const option=chartOption(chart!) as any;
    expect(option.xAxis.data).toEqual(['A','B']);
    expect(option.yAxis.data).toEqual(['1','2']);
    const cells=option.series[0].data;
    expect(cells[0].value).toEqual([0,0,2]);
    expect(cells[0].itemStyle.color).toBe('rgb(246,201,201)'); // positive: tinted red
    expect(cells[2].value).toEqual([0,1,-4]);
    expect(cells[2].itemStyle.color).toBe('rgb(146,177,245)'); // negative: tinted blue
  });
  it('rejects a non-ISO calendar_heatmap date and more than one named series', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'calendar_heatmap'};
    expect(validateChatChart({...base,series:[{label:'Jan 1',value:1}]})).toBeNull();
    expect(validateChatChart({...base,series:[{name:'a',points:[{x:'2026-01-01',y:1}]},{name:'b',points:[{x:'2026-01-02',y:1}]}]})).toBeNull();
  });
  it('ranges calendar_heatmap over the min/max date and colors by sign', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'calendar_heatmap',series:[
      {label:'2026-01-01',value:5},{label:'2026-01-03',value:-5}]});
    const option=chartOption(chart!) as any;
    expect(option.calendar.range).toEqual(['2026-01-01','2026-01-03']);
    expect(option.series[0].data[0]).toMatchObject({ value: ['2026-01-01',5], itemStyle: { color: 'rgb(220,38,38)' } });
    expect(option.series[0].data[1]).toMatchObject({ value: ['2026-01-03',-5], itemStyle: { color: 'rgb(37,99,235)' } });
  });
  it('rejects an OHLC bar whose low/high do not bound open/close', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'candlestick'};
    expect(validateChatChart({...base,series:[{name:'A',points:[{x:'d1',open:10,high:12,low:11,close:9}]}]})).toBeNull(); // low above close
    expect(validateChatChart({...base,series:[{name:'A',points:[{x:'d1',open:10,high:10.5,low:8,close:11}]}]})).toBeNull(); // high below close
    expect(validateChatChart({...base,series:[{name:'A',points:[{x:'d1',open:10,high:12,low:8,close:11}]}]})).not.toBeNull();
  });
  it('orders candlestick data as [open, close, low, high] and adds a colored volume bar only when given', () => {
    const noVolume=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'candlestick',series:[
      {name:'ACME',points:[{x:'d1',open:10,high:12,low:8,close:11}]}]});
    const s1=chartOption(noVolume!).series as any[];
    expect(s1).toHaveLength(1);
    expect(s1[0].data).toEqual([[10,11,8,12]]);
    const withVolume=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'candlestick',series:[
      {name:'ACME',points:[{x:'d1',open:10,high:12,low:8,close:9,volume:100}]}]}); // a down day
    const s2=chartOption(withVolume!).series as any[];
    expect(s2).toHaveLength(2);
    expect(s2[1].data[0].value).toBe(100);
    expect(s2[1].data[0].itemStyle.color).not.toBe(s1[0].itemStyle.color); // down-day color differs from the up color
  });
  it('computes an exact drawdown from the running peak, always nonpositive', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'drawdown',series:[
      {name:'eq',points:[{x:'t1',y:100},{x:'t2',y:80},{x:'t3',y:90}]}]});
    const data=(chartOption(chart!).series as any[])[0].data;
    expect(data).toEqual([0,-20,-10]);
  });
  it('compounds cumulative_return from periodic returns, not price levels', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'cumulative_return',series:[
      {name:'strat',points:[{x:'t1',y:0.1},{x:'t2',y:-0.05},{x:'t3',y:0.02}]}]});
    const data=(chartOption(chart!).series as any[])[0].data;
    expect(data[0]).toBeCloseTo(10,5);
    expect(data[1]).toBeCloseTo(4.5,5);
    expect(data[2]).toBeCloseTo(6.59,5);
  });
  it('rejects a gantt row whose low exceeds its high', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'gantt',
      series:[{name:'A',low:5,high:1}]})).toBeNull();
  });
  it('draws gantt bars for spans and a diamond marker for zero-duration milestones, grouped by color', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'gantt',series:[
      {name:'Design',low:0,high:5},{name:'Build',low:5,high:12,group:'dev'},{name:'Kickoff',low:0,high:0,group:'dev'}]});
    const option=chartOption(chart!);
    const series=option.series as any[];
    expect(series).toHaveLength(5); // 2 bars each for Design/Build, 1 marker for Kickoff
    const kickoff=series.find(s=>s.type==='scatter');
    expect(kickoff.data).toEqual([[0,2]]);
    const designSpan=series.find(s=>s.name==='Design');
    expect(designSpan.data).toEqual([5,null,null]);
    const buildSpan=series.find(s=>s.name==='dev' && s.type==='bar');
    expect(buildSpan.data).toEqual([null,7,null]);
    expect(buildSpan.itemStyle.color).toBe(kickoff.itemStyle.color); // same group, same color
  });
  it('rejects a hierarchy leaf with no value, and more than one tree root', () => {
    const leaf={schema_version:'bahulam_render_v1',type:'chart',chart_type:'treemap',
      series:[{name:'root',children:[{name:'a'}]}]}; // leaf 'a' has neither value nor children
    expect(validateChatChart(leaf)).toBeNull();
    const twoRoots={schema_version:'bahulam_render_v1',type:'chart',chart_type:'tree',
      series:[{name:'r1',value:1},{name:'r2',value:1}]};
    expect(validateChatChart(twoRoots)).toBeNull();
  });
  it('passes treemap/sunburst/tree nodes straight through with no transform', () => {
    for (const chart_type of ['treemap','sunburst']) {
      const payload={schema_version:'bahulam_render_v1',type:'chart',chart_type,
        series:[{name:'root',children:[{name:'a',value:3},{name:'b',value:5}]}]};
      const chart=validateChatChart(payload)!;
      expect((chartOption(chart).series as any[])[0].data).toEqual(payload.series);
    }
    const tree=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'tree',
      series:[{name:'root',children:[{name:'a',value:1}]}]});
    expect((chartOption(tree!).series as any[])[0].type).toBe('tree');
  });
  it('rejects a network link to an unknown node, a valueless sankey link, and a duplicate display name', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'graph'};
    expect(validateChatChart({...base,series:[{nodes:[{id:'a'}],links:[{source:'a',target:'zzz',value:1}]}]})).toBeNull();
    expect(validateChatChart({...base,chart_type:'sankey',series:[{nodes:[{id:'a'},{id:'b'}],links:[{source:'a',target:'b'}]}]})).toBeNull();
    expect(validateChatChart({...base,series:[{nodes:[{id:'a'},{id:'b'}],links:[{source:'a',target:'b'}]}]})).not.toBeNull(); // graph allows a valueless link
    expect(validateChatChart({...base,series:[{nodes:[{id:'a',name:'X'},{id:'b',name:'X'}],links:[{source:'a',target:'b'}]}]})).toBeNull();
  });
  it('maps sankey node ids to display names consistently between data and links', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'sankey',series:[
      {nodes:[{id:'a',name:'Alpha'},{id:'b'}],links:[{source:'a',target:'b',value:5}]}]});
    const series=(chartOption(chart!).series as any[])[0];
    expect(series.data).toEqual([{name:'Alpha'},{name:'b'}]);
    expect(series.links).toEqual([{source:'Alpha',target:'b',value:5}]);
  });
  it('sizes graph nodes by sqrt(value) and assigns categories by index', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'graph',series:[
      {nodes:[{id:'a',category:'cat1',value:4},{id:'b',category:'cat1'}],links:[{source:'a',target:'b'}]}]});
    const series=(chartOption(chart!).series as any[])[0];
    expect(series.data[0].symbolSize).toBe(8); // sqrt(4)*4 = 8, within [8,50]
    expect(series.data[0].category).toBe(0);
    expect(series.links[0].lineStyle.width).toBe(1); // no value given -> default width
  });
  it('colors and labels a graph link by relationship type, and draws an arrowhead when directed', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'graph',series:[
      {nodes:[{id:'a'},{id:'b'}],links:[{source:'a',target:'b',type:'dependency',directed:true}]}]});
    const link=(chartOption(chart!).series as any[])[0].links[0];
    expect(link.lineStyle.color).toBeTruthy();
    expect(link.label).toEqual({show:true,formatter:'dependency',color:expect.any(String),fontSize:10});
    expect(link.symbol).toEqual(['none','arrow']);
  });
  it('gives same-named sankey link types the same stable color, independent of flat ordering', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'sankey',series:[
      {nodes:[{id:'a'},{id:'b'},{id:'c'}],links:[{source:'a',target:'b',value:1,type:'x'},{source:'b',target:'c',value:1,type:'x'}]}]});
    const links=(chartOption(chart!).series as any[])[0].links;
    expect(links[0].lineStyle.color).toBe(links[1].lineStyle.color);
  });
  it('rejects a non-string link type and a directed flag on sankey (arrowheads are graph-only)', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'graph',
      series:[{nodes:[{id:'a'},{id:'b'}],links:[{source:'a',target:'b',type:5}]}]};
    expect(validateChatChart(base)).toBeNull();
    expect(validateChatChart({...base,chart_type:'sankey',series:[{nodes:[{id:'a'},{id:'b'}],links:[{source:'a',target:'b',value:1,directed:true}]}]})).toBeNull();
  });
});

describe('adoption safeguards', () => {
  it('rejects negative percentage contributions but preserves signed ordinary charts', () => {
    for (const chart_type of ['stacked_bar_100', 'stacked_area_100']) {
      expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type,series:[{label:'A',value:-1}]})).toBeNull();
      expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type,series:[{name:'A',points:[{x:'X',y:-1}]}]})).toBeNull();
    }
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:-1}]})).not.toBeNull();
  });
  it('keeps percentage totals precise, bounded and finite without mutating the input', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'stacked_area_100',series:
      ['one','two','three'].map(name=>({name,points:[{x:'A',y:1e308},{x:'Zero',y:0}]}))})!;
    const before=JSON.stringify(chart);
    const option=chartOption(chart);
    const series=option.series as any[];
    expect(series.reduce((sum,s)=>sum+s.data[0],0)).toBeCloseTo(100,10);
    expect(series.every(s=>s.data[1]===0)).toBe(true);
    expect((option.yAxis as any).max).toBe(100);
    expect(JSON.stringify(chart)).toBe(before);
  });
});


it('stacks signed intervals across zero and exposes real bounds for tooltips', () => {
  const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'range_area',series:[
    {name:'band',points:[{x:'A',low:-5,high:3},{x:'B',low:-7,high:-2}]}]})!;
  const series=chartOption(chart).series as any[];
  expect(series.every(s=>s.stackStrategy==='all')).toBe(true);
  expect(series[1].data).toEqual([[0,8,-5,3],[1,5,-7,-2]]);
  expect(validateChatChart({...chart,series:[{name:'band',points:[{x:'A',low:-1e308,high:1e308}]}]})).toBeNull();
});

it('keeps dumbbell stems connected across zero', () => {
  const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'dumbbell',series:[
    {name:'before',points:[{x:'A',y:-5}]},{name:'after',points:[{x:'A',y:3}]}]})!;
  const series=chartOption(chart).series as any[];
  expect(series[0].stackStrategy).toBe('all');
  expect(series[1].stackStrategy).toBe('all');
  expect(series[1].data).toEqual([8]);
});

describe('style, palette, accessibility and density', () => {
  const bar=(extra: object)=>({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',
    series:[{label:'A',value:5},{label:'B',value:9}],...extra});

  it('rejects an invalid density or an accessibility field of the wrong shape', () => {
    expect(validateChatChart(bar({density:'cozy'}))).toBeNull();
    expect(validateChatChart(bar({accessibility:{high_contrast:'yes'}}))).toBeNull();
    expect(validateChatChart(bar({accessibility:{unknown_flag:true}}))).toBeNull();
    expect(validateChatChart(bar({density:'compact',accessibility:{patterns:true}}))).not.toBeNull();
  });

  it('applies accessibility.high_contrast as the palette even without theme: high_contrast, reaching series that bake their own color', () => {
    // bubble bakes itemStyle.color directly per point rather than relying on
    // ECharts' own `option.color` cycling, so this exercises the case a
    // naive post-process over the built option could never reach.
    const plain=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bubble',
      series:[{name:'one',points:[{x:1,y:1,size:1}]}]});
    const hc=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bubble',
      series:[{name:'one',points:[{x:1,y:1,size:1}]}],accessibility:{high_contrast:true}});
    const plainColor=(chartOption(plain!).series as any[])[0].itemStyle.color;
    const hcColor=(chartOption(hc!).series as any[])[0].itemStyle.color;
    expect(hcColor).not.toBe(plainColor);
    // The high_contrast palette itself, read off a plain theme:'high_contrast'
    // chart (same palette, reached the ordinary way) rather than hardcoding it.
    const highContrastPalette=chartOption(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',
      series:[{label:'A',value:1}],theme:'high_contrast'})!).color as string[];
    expect(highContrastPalette).toContain(hcColor);
    expect(highContrastPalette).not.toContain(plainColor);
  });

  it('turns on decal patterns independent of high_contrast, and lets reduced_motion override either way', () => {
    const chart=validateChatChart(bar({accessibility:{patterns:true}}));
    const option=chartOption(chart!) as any;
    expect(option.aria.decal.show).toBe(true);
    const forcedOn=validateChatChart(bar({accessibility:{reduced_motion:true}}));
    expect((chartOption(forcedOn!) as any).animation).toBe(false);
    const forcedOff=validateChatChart(bar({accessibility:{reduced_motion:false}}));
    expect((chartOption(forcedOff!) as any).animation).toBe(true);
  });

  it('leaves the option unchanged when density is absent or comfortable (the default)', () => {
    const noDensity=chartOption(validateChatChart(bar({}))!);
    const comfortable=chartOption(validateChatChart(bar({density:'comfortable'}))!);
    expect(comfortable).toEqual(noDensity);
  });

  it('scales grid padding and text size with density, without touching the data', () => {
    const plain=validateChatChart(bar({}))!;
    const compact=validateChatChart(bar({density:'compact'}))!;
    const presentation=validateChatChart(bar({density:'presentation'}))!;
    const plainOpt=chartOption(plain) as any;
    const compactOpt=chartOption(compact) as any;
    const presentationOpt=chartOption(presentation) as any;
    expect(compactOpt.grid.left).toBeLessThan(plainOpt.grid.left);
    expect(presentationOpt.grid.left).toBeGreaterThan(plainOpt.grid.left);
    expect(compactOpt.textStyle.fontSize).toBeLessThan(presentationOpt.textStyle.fontSize);
    // Same series data at every density — density is spacing/size only.
    expect(compactOpt.series).toEqual(plainOpt.series);
  });

  it('assigns the same series a stable color regardless of its position among its siblings', () => {
    const forward=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'line',
      series:[{name:'Revenue',points:[{x:'A',y:1}]},{name:'Cost',points:[{x:'A',y:2}]}]});
    const reversed=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'line',
      series:[{name:'Cost',points:[{x:'A',y:2}]},{name:'Revenue',points:[{x:'A',y:1}]}]});
    const forwardSeries=(chartOption(forward!).series as any[]);
    const reversedSeries=(chartOption(reversed!).series as any[]);
    const colorOf=(series:any[],name:string)=>series.find(s=>s.name===name).itemStyle.color;
    expect(colorOf(forwardSeries,'Revenue')).toBe(colorOf(reversedSeries,'Revenue'));
    expect(colorOf(forwardSeries,'Cost')).toBe(colorOf(reversedSeries,'Cost'));
    expect(colorOf(forwardSeries,'Revenue')).not.toBe(colorOf(forwardSeries,'Cost'));
  });
});

describe('interactions: zoom/pan, reference lines and sort', () => {
  it('rejects sort on a type not in SORTABLE_CHART_TYPES, and reference_lines on a type not in INTERACTIVE_CHART_TYPES', () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'scatter',
      series:[{name:'a',points:[{x:1,y:1}]}],sort:'asc'})).toBeNull();
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pie',
      series:[{label:'A',value:1}],reference_lines:[{value:5}]})).toBeNull();
    // Multi-series bar: sorting is ambiguous (sort by which series?), so rejected.
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',
      series:[{name:'a',points:[{x:'X',y:1}]},{name:'b',points:[{x:'X',y:2}]}],sort:'asc'})).toBeNull();
  });

  it('rejects a malformed reference_lines entry', () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'line',series:[{name:'a',points:[{x:'A',y:1}]}]};
    expect(validateChatChart({...base,reference_lines:[{value:'five'}]})).toBeNull();
    expect(validateChatChart({...base,reference_lines:[{value:5,extra:1}]})).toBeNull();
    expect(validateChatChart({...base,reference_lines:[]})).toBeNull();
    expect(validateChatChart({...base,reference_lines:[{value:5,label:'Target'}]})).not.toBeNull();
  });

  it('sorts pie slices by value without mutating the input', () => {
    const payload={schema_version:'bahulam_render_v1',type:'chart',chart_type:'pie',
      series:[{label:'small',value:1},{label:'big',value:9}],sort:'asc' as const};
    const before=JSON.stringify(payload);
    const chart=validateChatChart(payload)!;
    const data=(chartOption(chart).series as any[])[0].data;
    expect(data.map((d:any)=>d.name)).toEqual(['small','big']);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it('sorts waffle names/values together before allocating squares', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'waffle',
      series:[{label:'small',value:10},{label:'big',value:90}],sort:'desc'});
    const series=chartOption(chart!).series as any[];
    expect(series[0].name).toBe('big');
    expect(series[0].data.length).toBe(90);
    expect(series[1].name).toBe('small');
    expect(series[1].data.length).toBe(10);
  });

  it('sorts single-series bar categories by value, but leaves lollipop/bar input order alone when sort is absent', () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',
      series:[{label:'small',value:1},{label:'big',value:9}],sort:'desc'});
    const option=chartOption(chart!) as any;
    expect(option.xAxis.data).toEqual(['big','small']);
    const unsorted=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',
      series:[{label:'small',value:1},{label:'big',value:9}]});
    expect((chartOption(unsorted!) as any).xAxis.data).toEqual(['small','big']);
  });

  it('adds inside dataZoom on both axes for interactive types, and omits it for non-interactive types', () => {
    const line=chartOption(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'line',
      series:[{name:'a',points:[{x:'A',y:1}]}]})!) as any;
    expect(line.dataZoom).toEqual([{type:'inside',xAxisIndex:0,filterMode:'none'},{type:'inside',yAxisIndex:0,filterMode:'none'}]);
    const pie=chartOption(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pie',
      series:[{label:'A',value:1}]})!) as any;
    expect(pie.dataZoom).toBeUndefined();
  });

  it('draws reference_lines as a markLine on the first series, against the value axis', () => {
    const vertical=chartOption(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'line',
      series:[{name:'a',points:[{x:'A',y:1}]}],reference_lines:[{value:50,label:'Target'}]})!) as any;
    expect(vertical.series[0].markLine.data).toEqual([{yAxis:50,label:{formatter:'Target'}}]);
    const horizontal=chartOption(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'horizontal_bar',
      series:[{name:'a',points:[{x:'A',y:1}]}],reference_lines:[{value:50}]})!) as any;
    expect(horizontal.series[0].markLine.data).toEqual([{xAxis:50,label:{formatter:''}}]);
  });
});


it('zoom preserves interval and stacked helper rows instead of filtering their raw values', () => {
  const option = chartOption({schema_version:'bahulam_render_v1',type:'chart',chart_type:'range_area',series:[{name:'Band',points:[{x:'A',low:-5,high:3}]}]});
  expect(option.dataZoom).toEqual([
    {type:'inside',xAxisIndex:0,filterMode:'none'},
    {type:'inside',yAxisIndex:0,filterMode:'none'},
  ]);
});

describe('visual_style', () => {
  it("rejects visual_style: 'outlined' for a chart_type outside FILL_SAFE_CHART_TYPES, but allows 'flat' everywhere", () => {
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pie',
      series:[{label:'A',value:1}],visual_style:'outlined'})).toBeNull();
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pie',
      series:[{label:'A',value:1}],visual_style:'flat'})).not.toBeNull();
    expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',
      series:[{label:'A',value:1}],visual_style:'outlined'})).not.toBeNull();
  });

  it("strips each series' fill to a transparent center plus a colored border, and zeroes area fill", () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'area',
      series:[{name:'Revenue',points:[{x:'A',y:1}]}],visual_style:'outlined'});
    const series=(chartOption(chart!).series as any[])[0];
    expect(series.itemStyle.color).toBe('transparent');
    expect(series.itemStyle.borderColor).toBeTruthy();
    expect(series.itemStyle.borderWidth).toBe(2);
    expect(series.areaStyle.opacity).toBe(0);
  });

  it("leaves the option unchanged for visual_style: 'flat' or when the field is absent", () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}]};
    const absent=chartOption(validateChatChart(base)!);
    const flat=chartOption(validateChatChart({...base,visual_style:'flat'})!);
    expect(flat).toEqual(absent);
  });

  it("rejects 'glassmorphism' and 'skeuomorphism' outside FILL_SAFE_CHART_TYPES too, since both rewrite fill", () => {
    for (const visual_style of ['glassmorphism', 'skeuomorphism']) {
      expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pie',
        series:[{label:'A',value:1}],visual_style})).toBeNull();
      expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',
        series:[{label:'A',value:1}],visual_style})).not.toBeNull();
    }
  });

  it('allows the 8 chrome/typography-only styles on every chart_type, including pie where fill is the encoding', () => {
    for (const visual_style of ['minimalism', 'material', 'neumorphism', 'claymorphism', 'editorial', 'technical', 'hand_drawn', 'brutalist']) {
      expect(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'pie',
        series:[{label:'A',value:1}],visual_style})).not.toBeNull();
    }
  });

  it("'glassmorphism' fades the fill but falls back to the unmodified option under high_contrast", () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}],visual_style:'glassmorphism' as const};
    const chart=validateChatChart(base)!;
    const series=(chartOption(chart).series as any[])[0];
    expect(series.itemStyle.opacity).toBe(0.55);
    expect(series.itemStyle.shadowBlur).toBeGreaterThan(0);
    const highContrast=validateChatChart({...base,accessibility:{high_contrast:true}})!;
    expect(chartOption(highContrast)).toEqual(chartOption(validateChatChart({...base,visual_style:undefined,accessibility:{high_contrast:true}})!));
  });

  it("'skeuomorphism' turns a flat fill into a two-stop gloss gradient plus a drop shadow, without moving the shape", () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}],visual_style:'skeuomorphism'});
    const itemStyle=(chartOption(chart!).series as any[])[0].itemStyle;
    expect(itemStyle.color.type).toBe('linear');
    expect(itemStyle.color.colorStops).toHaveLength(2);
    expect(itemStyle.shadowOffsetY).toBeGreaterThan(0);
  });

  it("'minimalism' hides axis split lines and ticks without touching the data", () => {
    const chart=validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}],visual_style:'minimalism'});
    const option=chartOption(chart!) as any;
    expect(option.xAxis.splitLine.show).toBe(false);
    expect(option.yAxis.axisTick.show).toBe(false);
    expect(option.series[0].data).toEqual(chartOption(validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}]})!).series[0].data);
  });

  it("'material' adds elevation shadow and rounded corners; 'neumorphism'/'claymorphism' always pair their shadow with a visible border", () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}]};
    const material=(chartOption(validateChatChart({...base,visual_style:'material'})!).series as any[])[0].itemStyle;
    expect(material.shadowBlur).toBeGreaterThan(0);
    expect(material.borderRadius).toBeGreaterThan(0);
    for (const visual_style of ['neumorphism', 'claymorphism']) {
      const itemStyle=(chartOption(validateChatChart({...base,visual_style})!).series as any[])[0].itemStyle;
      expect(itemStyle.shadowBlur).toBeGreaterThan(0);
      expect(itemStyle.borderWidth).toBeGreaterThan(0);
      expect(itemStyle.borderColor).toBeTruthy();
    }
  });

  it("'brutalist' draws a hard black border with no radius or shadow, switching to white under high_contrast", () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}],visual_style:'brutalist' as const};
    const flat=(chartOption(validateChatChart(base)!).series as any[])[0].itemStyle;
    expect(flat.borderColor).toBe('#000000');
    expect(flat.borderRadius).toBe(0);
    expect(flat.shadowBlur).toBe(0);
    const highContrast=(chartOption(validateChatChart({...base,accessibility:{high_contrast:true}})!).series as any[])[0].itemStyle;
    expect(highContrast.borderColor).toBe('#ffffff');
  });

  it("'editorial'/'technical'/'hand_drawn' set a distinct font family; 'hand_drawn' also dashes the border", () => {
    const base={schema_version:'bahulam_render_v1',type:'chart',chart_type:'bar',series:[{label:'A',value:5}]};
    const editorial=chartOption(validateChatChart({...base,visual_style:'editorial'})!).textStyle as any;
    const technical=chartOption(validateChatChart({...base,visual_style:'technical'})!).textStyle as any;
    expect(editorial.fontFamily).not.toBe(technical.fontFamily);
    const handDrawn=validateChatChart({...base,visual_style:'hand_drawn'})!;
    const option=chartOption(handDrawn) as any;
    expect(option.textStyle.fontFamily).toMatch(/cursive|Comic/);
    expect(option.series[0].itemStyle.borderType).toBe('dashed');
  });
});
