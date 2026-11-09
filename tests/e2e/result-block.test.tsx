import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ResultBlock } from '../../packages/workplane-ui/src/react/result-block.js';
import { RendererRegistry } from '../../packages/workplane-ui/src/react/registry.js';
import { tableRenderer } from '../../packages/workplane-ui/src/react/blocks/table.js';
import type { Block } from '../../packages/workplane-ui/src/core/index.js';
import type { QueryResult } from '../../packages/workplane-ui/src/data/index.js';
afterEach(cleanup);
const block: Block = { id:'b', kind:'table', title:'Actual counts', rendererId:'workplane.table', specVersion:'1', spec:{source:'query',queryId:'q',columns:['count'],pageSize:20}, bindings:{}, dataRefs:['q'], fallback:'View unavailable' };
const data: QueryResult = {queryId:'q',resultId:'r',partition:'user:job',sourceVersion:'v1',parameterFingerprint:'p',executedAt:'2026-10-11',columns:[{name:'count',type:'number'}],rows:[[42]],rowCount:1,rowCountIsEstimate:false,freshness:'unknown',generation:1};
const registry = new RendererRegistry().register(tableRenderer);
const props = {block,revision:'1',registry,partition:'user:job',request:{queryId:'q',spec:{},parameters:{}}};
describe('inline authorized result', () => {
 it('renders real endpoint values', async () => {
  render(<ResultBlock {...props} provider={{id:'test',execute:async()=>data}}/>);
  expect(await screen.findByText('42')).toBeTruthy();
 });
 it('rejects a result from another partition', async () => {
  render(<ResultBlock {...props} provider={{id:'test',execute:async()=>({...data,partition:'other'})}}/>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('42')).toBeNull();
 });
 it('does not request data for unsupported renderers', async () => {
  const execute=vi.fn();
  render(<ResultBlock {...props} block={{...block,rendererId:'unknown'}} provider={{id:'test',execute}}/>);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(execute).not.toHaveBeenCalled();
 });
 it('cancels pending retrieval on unmount', () => {
  const execute=vi.fn(() => new Promise<QueryResult>(()=>{}));
  const view=render(<ResultBlock {...props} provider={{id:'test',execute}}/>);
  view.unmount();
  expect(execute.mock.calls[0]?.[0]?.signal.aborted).toBe(true);
 });
});
