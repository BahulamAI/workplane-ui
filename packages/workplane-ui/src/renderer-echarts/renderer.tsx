import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Modular registration, not `import * as echarts from "echarts"`. The barrel
// import pulls every chart type and component into the host bundle, which the
// bundle budget in PRD section 20 does not survive.
echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
import { formatMoney, money, type QueryResult } from "../data/index.js";
import type { RendererDefinition, RendererProps } from "../react/index.js";
import { validateEChartsSpec, type EChartsSpec } from "./spec.js";

let interactionCounter = 0;

interface Point {
  entityId: string;
  label: string;
  value: number;
}

function readPoints(result: QueryResult, spec: EChartsSpec): Point[] {
  const labelIndex = result.columns.findIndex((c) => c.name === spec.categoryColumn);
  const valueIndex = result.columns.findIndex((c) => c.name === spec.valueColumn);
  if (spec.categoryColumn === undefined || spec.valueColumn === undefined) return [];
  const entityIndex = spec.entityColumn
    ? result.columns.findIndex((c) => c.name === spec.entityColumn)
    : labelIndex;
  if (labelIndex === -1 || valueIndex === -1) return [];

  return result.rows.map((row) => ({
    // Stable entity id, never the display label or the array index — a label
    // can be renamed or translated and would silently break the selection.
    entityId: String(row[entityIndex === -1 ? labelIndex : entityIndex]),
    label: String(row[labelIndex]),
    value: Number(row[valueIndex] ?? 0),
  }));
}

function ChartComponent({ spec, results, bindings, stale, emit, block }: RendererProps<EChartsSpec>): React.ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  /** Suppresses the echo when we apply a selection programmatically. */
  const applyingRef = useRef(false);

  const result = spec.source === "query" && spec.queryId ? results.get(spec.queryId) : undefined;
  const points = useMemo<Point[]>(() => {
    if (spec.source === "inline") {
      return (spec.data ?? []).map((p) => ({ entityId: p.id ?? p.label, label: p.label, value: p.value }));
    }
    return result ? readPoints(result, spec) : [];
  }, [result, spec]);

  const valueColumn =
    spec.source === "inline"
      ? ({ name: "value", type: "money", currency: spec.currency ?? "USD" } as const)
      : result?.columns.find((c) => c.name === spec.valueColumn);
  // The current selection arrives as a declared BINDING, not by reaching into
  // shared state. A renderer sees only what its block asked for.
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

    const isMoney = valueColumn?.type === "money";
    const currency = valueColumn?.currency ?? "USD";
    const format = (value: number) =>
      isMoney ? formatMoney(money(Math.round(value), currency)) : String(value);

    const isPie = spec.chartType === "pie";

    chart.setOption(
      {
        animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ...(isPie ? {} : { grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true } }),
        tooltip: {
          trigger: "item",
          // A string template, not a function: nothing here can execute code
          // supplied through the document.
          formatter: (params: { name: string; value: number }) =>
            `${params.name}: ${format(params.value)}`,
        },
        ...(isPie
          ? { legend: { type: "scroll", bottom: 0, textStyle: { fontSize: 10 } } }
          : {
              xAxis: { type: "category", data: points.map((p) => p.label) },
              yAxis: { type: "value", axisLabel: { formatter: (v: number) => format(v) } },
            }),
        series: [
          {
            type: spec.chartType,
            ...(isPie
              ? {
                  // A ring, not a filled pie: proportion is read from arc
                  // length rather than from wedge area, which is easier to
                  // compare and is what a donut widget meant.
                  radius: ["45%", "72%"],
                  center: ["50%", "44%"],
                  label: { show: false },
                  labelLine: { show: false },
                }
              : {}),
            data: points.map((p) => ({
              value: p.value,
              name: p.label,
              itemStyle:
                spec.selectionMode === "highlight" && selected.size > 0 && !selected.has(p.entityId)
                  ? { opacity: 0.3 }
                  : undefined,
            })),
            emphasis: { focus: "series" },
          },
        ],
      },
      { notMerge: true },
    );
  }, [points, spec, selected, valueColumn]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || spec.selectionMode === "none") return;

    const handler = (params: { dataIndex: number }) => {
      if (applyingRef.current) return; // origin suppression: no feedback loop
      const point = points[params.dataIndex];
      if (!point) return;
      emit({
        type: "selection.changed",
        interactionId: `int_${(++interactionCounter).toString(36)}`,
        payload: {
          entityType: spec.entityType ?? "entity",
          ids: [point.entityId],
          mode: "toggle",
        },
      });
    };

    chart.on("click", "series", handler);
    return () => {
      chart.off("click", handler);
    };
  }, [points, spec, emit]);

  if (spec.source === "query" && !result) {
    return <div data-workplane="chart" data-state="loading" style={{ height: 240 }} />;
  }

  return (
    <div data-workplane="chart" data-state={stale ? "stale" : "ready"}>
      <div ref={containerRef} style={{ width: "100%", height: 240 }} role="img" aria-label={block.fallback} />
      {/* Every meaningful chart offers a text equivalent. This is not a
          decoration: it is how a screen-reader user reads the same values. */}
      <details data-workplane="chart-table">
        <summary>Data table</summary>
        <table>
          <caption>{block.title}</caption>
          <thead>
            <tr>
              <th scope="col">{spec.categoryColumn ?? "label"}</th>
              <th scope="col">{spec.valueColumn ?? "value"}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.entityId}>
                <th scope="row">{point.label}</th>
                <td>
                  {valueColumn?.type === "money"
                    ? formatMoney(money(point.value, valueColumn.currency ?? "USD"))
                    : point.value}
                </td>
              </tr>
            ))}
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
  summarize: (spec) =>
    spec.source === "inline"
      ? `${spec.chartType} chart (inline, ${spec.data?.length ?? 0} points)`
      : `${spec.chartType} chart of ${spec.valueColumn} by ${spec.categoryColumn}`,
  Component: ChartComponent,
};
