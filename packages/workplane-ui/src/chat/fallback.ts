import type { ChatChartPresentation } from './contract.js';

export interface ChatChartSourceRow { path: string; value: string }

/** Flatten original chart input values for a readable, non-derived fallback table. */
export function chartSourceRows(value: unknown): ChatChartSourceRow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const chart = value as Partial<ChatChartPresentation>;
  if (!Array.isArray(chart.series)) return [];
  const rows: ChatChartSourceRow[] = [];
  const visit = (path: string, item: unknown, depth = 0): void => {
    if (rows.length >= 5000 || depth > 12) return;
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      rows.push({ path, value: String(item) });
    } else if (Array.isArray(item)) {
      item.forEach((child, index) => visit(`${path}[${index}]`, child, depth + 1));
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) visit(path ? `${path}.${key}` : key, child, depth + 1);
    }
  };
  chart.series.forEach((series, index) => {
    const name = series && typeof series === 'object' && 'name' in series ? String(series.name) : `Series ${index + 1}`;
    visit(name, series);
  });
  return rows;
}
