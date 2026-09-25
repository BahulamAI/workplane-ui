import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, MarkPointComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatMoney, money, type QueryResult, type ResultColumn } from "../data/index.js";
import type { JsonValue } from "../protocol/index.js";
import type { RendererDefinition, RendererProps } from "../react/index.js";
import { describeKeyTree } from "../core/index.js";
import { ECHARTS_ALLOW } from "./allowlist.js";
import { validateEChartsSpec, type EChartsSpec } from "./spec.js";

// Modular registration, not `import * as echarts from "echarts"`. The barrel
// import pulls every chart type into the host bundle, which the bundle budget
// in PRD section 20 does not survive.
echarts.use([
  BarChart, LineChart, PieChart,
  GridComponent, LegendComponent, TooltipComponent, TitleComponent,
  MarkLineComponent, MarkPointComponent,
  CanvasRenderer,
]);

let interactionCounter = 0;

interface Bound {
  option: Record<string, JsonValue>;
  /** Entity id per category index, for selection events. */
  entities: string[];
  valueColumn: ResultColumn | undefined;
}

/**
 * Inject query results into the option.
 *
 * The option describes appearance; the binding says which column feeds which
 * series. Keeping them apart is what lets a chart be re-pointed at different
 * data without rewriting its appearance, and lets appearance change without
 * touching the data contract.
 */
function bindData(spec: EChartsSpec, result: QueryResult | undefined): Bound {
  const option = JSON.parse(JSON.stringify(spec.option)) as Record<string, JsonValue>;
  const entities: string[] = [];
  if (!spec.bind || !result) return { option, entities, valueColumn: undefined };

  const indexOf = (name: string) => result.columns.findIndex((c) => c.name === name);
  const series = Array.isArray(option.series) ? (option.series as Record<string, JsonValue>[]) : [];

  const categoryIndex = spec.bind.categoryColumn ? indexOf(spec.bind.categoryColumn) : -1;
  if (categoryIndex !== -1) {
    const categories = result.rows.map((row) => String(row[categoryIndex] ?? ""));
    const axes = Array.isArray(option.xAxis) ? (option.xAxis as Record<string, JsonValue>[]) : [];
    if (axes[0]) axes[0].data = categories;
  }

  let valueColumn: ResultColumn | undefined;
  for (const binding of spec.bind.series) {
    const target = series[binding.index];
    if (!target) continue;
    const valueIndex = indexOf(binding.valueColumn);
    if (valueIndex === -1) continue;
    valueColumn ??= result.columns[valueIndex];

    const entityIndex = binding.entityColumn ? indexOf(binding.entityColumn) : categoryIndex;
    target.data = result.rows.map((row, rowIndex) => {
      // Stable entity id, never the array index: a reordered result must not
      // silently repoint a saved selection at a different thing.
      const id = String(row[entityIndex === -1 ? categoryIndex : entityIndex] ?? rowIndex);
      if (binding.index === spec.bind!.series[0]!.index) entities[rowIndex] = id;
      return {
        value: Number(row[valueIndex] ?? 0),
        ...(categoryIndex !== -1 ? { name: String(row[categoryIndex] ?? "") } : {}),
      };
    }) as unknown as JsonValue;
  }
  return { option, entities, valueColumn };
}

function ChartComponent({ spec, results, bindings, stale, emit, block }: RendererProps<EChartsSpec>): React.ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const result = spec.bind ? results.get(spec.bind.queryId) : undefined;
  const { option, entities, valueColumn } = useMemo(() => bindData(spec, result), [spec, result]);

  const selected = useMemo(() => {
    const raw = bindings.selection;
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  }, [bindings.selection]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      // Disposal removes listeners, observers, and the canvas. Revisiting a
      // scene must not accumulate a second set of handlers.
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const reduced = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const dimmed =
      spec.selectionMode === "highlight" && selected.size > 0
        ? { ...option, series: (option.series as Record<string, JsonValue>[]).map((s) => ({ ...s })) }
        : option;

    chart.setOption({ animation: !reduced, ...dimmed }, { notMerge: true });
  }, [option, spec.selectionMode, selected]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || spec.selectionMode === "none") return;
    const handler = (params: { dataIndex?: number }) => {
      const id = params.dataIndex === undefined ? undefined : entities[params.dataIndex];
      if (!id) return;
      emit({
        type: "selection.changed",
        interactionId: `int_${(++interactionCounter).toString(36)}`,
        payload: { entityType: spec.entityType ?? "entity", ids: [id], mode: "toggle" },
      });
    };
    chart.on("click", "series", handler as never);
    return () => { chart.off("click", handler as never); };
  }, [entities, spec, emit]);

  if (spec.bind && !result) {
    return <div data-workplane="chart" data-state="loading" style={{ height: 240 }} />;
  }

  const series = Array.isArray(option.series) ? (option.series as Record<string, JsonValue>[]) : [];
  const money$ = (value: number) =>
    valueColumn?.type === "money"
      ? formatMoney(money(Math.round(value), valueColumn.currency ?? "USD"))
      : String(value);

  return (
    <div data-workplane="chart" data-state={stale ? "stale" : "ready"}>
      <div ref={containerRef} style={{ width: "100%", height: 260 }} role="img" aria-label={block.fallback} />
      {/* Every meaningful chart offers a text equivalent. Not decoration: it is
          how a screen-reader user reads the same values, and it is what makes a
          multi-series chart comprehensible without colour. */}
      <details data-workplane="chart-table">
        <summary>Data table</summary>
        <table>
          <caption>{block.title}</caption>
          <tbody>
            {series.map((s, i) => {
              const data = Array.isArray(s.data) ? (s.data as JsonValue[]) : [];
              return (
                <tr key={String(s.id ?? s.name ?? i)}>
                  <th scope="row">{String(s.name ?? s.id ?? `Series ${i + 1}`)}</th>
                  <td>
                    {data
                      .map((point) => {
                        const value =
                          typeof point === "object" && point !== null && !Array.isArray(point)
                            ? Number((point as Record<string, JsonValue>).value ?? 0)
                            : Number(point);
                        return money$(value);
                      })
                      .join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export const echartsRenderer: RendererDefinition<EChartsSpec> = {
  id: "workplane.echarts",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: true,
    selection: true,
    thumbnail: true,
    staticExport: true,
    suspend: true,
    requiresWebGL: false,
  },
  validate: validateEChartsSpec,
  Component: ChartComponent,
  summarize: (spec) => {
    const series = Array.isArray(spec.option.series) ? (spec.option.series as Record<string, JsonValue>[]) : [];
    const kinds = [...new Set(series.map((s) => String(s.type ?? "?")))].join("/");
    return `${series.length} ${kinds} series${spec.bind ? ` from ${spec.bind.queryId}` : " (inline)"}`;
  },
};

/** What this adapter accepts, for catalog discovery by an agent. */
export function echartsSpecShape(): string {
  return (
    "{ option: <ECharts option>, bind?: { queryId, categoryColumn?, series: [{ index, valueColumn, entityColumn? }] }, " +
    "entityType?, selectionMode?: none|highlight|filter, selectionPath? }\n" +
    `option accepts: ${describeKeyTree(ECHARTS_ALLOW)}`
  );
}
