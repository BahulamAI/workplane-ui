import type { Operation } from "@bahulam/workplane-protocol";

/** The widget shape the existing `workplane` KV key holds. */
export interface LegacyWidget {
  id: string;
  type: "metric" | "bar_chart" | "line_chart" | "donut_chart" | "table" | "alert" | "three_scene";
  title?: string;
  value?: unknown;
  format?: unknown;
  currency?: string;
  tone?: string;
  message?: string;
  data?: Array<{ label?: string; value?: unknown }>;
  columns?: string[];
  rows?: unknown[][];
  scene?: { kind?: string; data?: Array<{ label?: string; value?: unknown }> };
}

export interface LegacyWorkplane {
  version?: number;
  title?: string;
  widgets?: LegacyWidget[];
  updated_at?: string;
}

/**
 * Which renderer displays a legacy widget type.
 *
 * `three_scene` has no entry: the 3D renderer is an M5 package, so such a
 * widget imports as an unsupported-renderer block that shows its title and
 * fallback text. That is the correct outcome — dropping it silently would lose
 * the user's content, and faking it with a bar chart would misrepresent it.
 */
const RENDERER_BY_TYPE: Record<string, string> = {
  metric: "workplane.metric",
  bar_chart: "workplane.echarts",
  line_chart: "workplane.echarts",
  donut_chart: "workplane.echarts",
  table: "workplane.table",
  alert: "workplane.text",
};

function literalRows(widget: LegacyWidget): Array<{ label: string; value: number }> {
  return (widget.data ?? []).map((point) => ({
    label: String(point?.label ?? ""),
    value: Number(point?.value ?? 0),
  }));
}

/**
 * Read the legacy widget list into Workplane operations.
 *
 * This is a one-way import, not a live bridge. The legacy key keeps its own
 * shape and its own panel; nothing here writes back to it, so the two cannot
 * fight over one value. PRD section 15.3.
 *
 * Legacy widgets carry literal values rather than query references, so the
 * imported blocks are snapshots. They are labelled as such in their fallback
 * text: a legacy widget has no query to re-run, and pretending otherwise would
 * imply a freshness the data does not have.
 */
export function importLegacyWorkplane(
  legacy: LegacyWorkplane | null | undefined,
  options: { sceneId?: string; sceneTitle?: string } = {},
): Operation[] {
  const widgets = Array.isArray(legacy?.widgets) ? legacy.widgets : [];
  if (widgets.length === 0) return [];

  const sceneId = options.sceneId ?? "imported";
  const operations: Operation[] = [
    {
      op: "scene.add",
      scene: {
        id: sceneId,
        title: options.sceneTitle ?? legacy?.title ?? "Imported widgets",
        layout: "grid",
      },
    },
  ];

  for (const widget of widgets) {
    const rendererId = RENDERER_BY_TYPE[widget.type] ?? `legacy.${widget.type}`;
    const title = widget.title ?? widget.id;
    const fallback = `${title} — imported from a legacy widget snapshot${
      legacy?.updated_at ? ` taken ${legacy.updated_at}` : ""
    }`;

    let spec: Record<string, unknown>;
    switch (widget.type) {
      case "metric":
        spec = { literal: widget.value ?? null, currency: widget.currency, format: widget.format };
        break;
      case "bar_chart":
      case "line_chart":
      case "donut_chart":
        spec = {
          chartType: widget.type === "line_chart" ? "line" : "bar",
          literal: literalRows(widget),
          currency: widget.currency,
        };
        break;
      case "table":
        spec = { columns: widget.columns ?? [], literal: widget.rows ?? [], currency: widget.currency };
        break;
      case "alert":
        spec = { text: widget.message ?? "", generated: false, tone: widget.tone };
        break;
      case "three_scene":
        spec = { kind: widget.scene?.kind ?? "bar_landscape", literal: widget.scene?.data ?? [] };
        break;
      default:
        spec = {};
    }

    operations.push({
      op: "block.add",
      sceneId,
      block: {
        id: `legacy_${widget.id.replace(/[^A-Za-z0-9_.:-]/g, "_")}`,
        kind: `legacy.${widget.type}`,
        title,
        rendererId,
        specVersion: "1",
        spec: spec as never,
        fallback,
      },
    });
  }

  return operations;
}
