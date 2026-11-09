import { describe, expect, it } from 'vitest';
import { chartCatalog, CHART_TYPES, validateChatChart } from '../../packages/workplane-ui/src/chat/contract';
import { chartOption } from '../../packages/workplane-ui/src/chat/engine';
describe('portable chat chart contract', () => {
  for (const chart_type of CHART_TYPES) it(`renders ${chart_type} as a supported ECharts option`, () => {
    const chart = validateChatChart({schema_version:'bahulam_render_v1',type:'chart',chart_type,series:[{label:'A',value:5},{label:'B',value:9}]});
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
});
