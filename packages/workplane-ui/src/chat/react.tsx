import { useEffect, useRef, useState } from 'react';
import { chartSourceRows } from './fallback.js';
import { mountChatChart } from './engine.js';
import { validateChatChart, chatChartHeight } from './contract.js';
export function ChatChart({ payload, onSelect }: { payload: unknown; onSelect?: (point: { seriesIndex: number; dataIndex: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const rows = chartSourceRows(payload);
  const [error, setError] = useState(false);
  const chart = validateChatChart(payload);
  useEffect(() => {
    setError(false);
    setPage(0);
    if (!ref.current) return;
    try { const view = mountChatChart(ref.current, payload, onSelect); return () => view.dispose(); }
    catch { setError(true); }
  }, [payload, onSelect]);
  if (!chart) return <p role="alert">This chart format is not supported.</p>;
  return <figure aria-label={chart.title || 'Chart'} style={{ margin: 0, width: '100%', minWidth: 0 }}>
    {chart.title && <figcaption style={{ fontWeight: 600 }}>{chart.title}</figcaption>}
    {error && <p role="alert">Unable to display this chart.</p>}
    <div ref={ref} style={{ width: '100%', height: chatChartHeight(chart.chart_type) }} />
    <details open={error || undefined}>
      <summary>Source data ({rows.length} values)</summary>
      <p>Original input values; bins, percentages and other derived chart marks are not substituted.</p>
      <table>
        <caption>{chart.title || chart.chart_type} — source data</caption>
        <thead><tr><th scope="col">Data path</th><th scope="col">Value</th></tr></thead>
        <tbody>{rows.slice(page * 100, (page + 1) * 100).map(row => <tr key={row.path}><th scope="row">{row.path}</th><td>{row.value}</td></tr>)}</tbody>
      </table>
      {rows.length > 100 && <div>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous data</button>
        <span> Page {page + 1} of {Math.ceil(rows.length / 100)} </span>
        <button disabled={(page + 1) * 100 >= rows.length} onClick={() => setPage(page + 1)}>Next data</button>
      </div>}
    </details>
    {chart.observations?.map((text, i) => <p key={i}>{text}</p>)}
  </figure>;
}
