import { useEffect, useRef, useState } from 'react';
import { mountChatChart } from './engine.js';
import { validateChatChart, chatChartHeight } from './contract.js';
export function ChatChart({ payload }: { payload: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const chart = validateChatChart(payload);
  useEffect(() => {
    setError(false);
    if (!ref.current) return;
    try { const view = mountChatChart(ref.current, payload); return () => view.dispose(); }
    catch { setError(true); }
  }, [payload]);
  if (!chart) return <p role="alert">This chart format is not supported.</p>;
  return <figure aria-label={chart.title || 'Chart'} style={{ margin: 0, width: '100%', minWidth: 0 }}>
    {chart.title && <figcaption style={{ fontWeight: 600 }}>{chart.title}</figcaption>}
    {error && <p role="alert">Unable to display this chart.</p>}
    <div ref={ref} style={{ width: '100%', height: chatChartHeight(chart.chart_type) }} />
    {chart.observations?.map((text, i) => <p key={i}>{text}</p>)}
  </figure>;
}
