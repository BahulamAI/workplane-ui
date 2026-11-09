import { describe, expect, it } from 'vitest';
import { chartCatalog, CHART_TYPES, validateChatChart } from '../../packages/workplane-ui/src/chat/contract';
import { chartOption } from '../../packages/workplane-ui/src/chat/engine';
// Most types accept the plain {label, value} shape; a few need a shape that
// shows what makes them distinct (range_area's bounds, dumbbell's exactly-two
// series) to even validate.
const fixtureFor = (chart_type: string) =>
  chart_type === 'range_area' ? [{name:'one',points:[{x:'A',low:1,high:5}]}]
  : chart_type === 'dumbbell' ? [{name:'before',points:[{x:'A',y:1}]},{name:'after',points:[{x:'A',y:9}]}]
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
