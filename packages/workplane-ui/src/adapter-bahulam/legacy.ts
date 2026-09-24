import type { Operation } from "../protocol/index.js";

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

/**
 * Legacy widgets carry MAJOR units — `412.3` means $412.30. Every money value
 * inside Workplane is integer minor units, so the conversion happens here, at
 * the import boundary, exactly as the tool provider converts at the read
 * boundary. Skipping it would turn $412.30 into $4.12.
 */
function toMinorUnits(amount: unknown, scale = 2): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10 ** scale);
}

function isMoney(widget: LegacyWidget): boolean {
  return widget.format === "currency" || widget.currency !== undefined;
}

function literalPoints(widget: LegacyWidget): Array<{ id: string; label: string; value: number }> {
  const money = isMoney(widget);
  return (widget.data ?? []).map((point) => {
    const label = String(point?.label ?? "");
    return {
      // Stable id derived from the label — the only identity a legacy widget has.
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || label,
      label,
      value: money ? toMinorUnits(point?.value) : Number(point?.value ?? 0),
    };
  });
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
/**
 * Map ONE legacy widget onto a block.
 *
 * Exported so the host runtime and this browser adapter share a single
 * implementation: two copies of this mapping would drift, and the drift would
 * show up as an agent's chart rendering differently depending on which side
 * wrote it.
 */
export function legacyWidgetToBlock(
  widget: LegacyWidget,
  options: { idPrefix?: string; updatedAt?: string; provenance?: string } = {},
): import("../protocol/index.js").BlockInput {
  const rendererId = RENDERER_BY_TYPE[widget.type] ?? `legacy.${widget.type}`;
  const title = widget.title ?? widget.id;
  const prefix = options.idPrefix ?? "";

  let spec: Record<string, unknown>;
  switch (widget.type) {
    case "metric":
      spec = {
        value: isMoney(widget) ? toMinorUnits(widget.value) : Math.round(Number(widget.value ?? 0)),
        ...(widget.currency ? { currency: widget.currency } : {}),
      };
      break;
    case "bar_chart":
    case "line_chart":
    case "donut_chart":
      spec = {
        chartType:
          widget.type === "line_chart" ? "line" : widget.type === "donut_chart" ? "pie" : "bar",
        data: literalPoints(widget),
        ...(widget.currency ? { currency: widget.currency } : {}),
      };
      break;
    case "table": {
      const columns = widget.columns ?? [];
      const formats = (widget.format ?? {}) as Record<string, string>;
      const moneyColumns = columns.filter((_, index) => formats[String(index)] === "currency");
      const moneyIndexes = new Set(
        columns.map((_, i) => i).filter((i) => formats[String(i)] === "currency"),
      );
      spec = {
        columns,
        rows: (widget.rows ?? []).map((row) =>
          row.map((cell, index) => (moneyIndexes.has(index) ? toMinorUnits(cell) : String(cell ?? ""))),
        ),
        ...(moneyColumns.length ? { moneyColumns } : {}),
        ...(widget.currency ? { currency: widget.currency } : {}),
        pageSize: 12,
      };
      break;
    }
    case "alert":
      spec = { text: widget.message ?? "", generated: false };
      break;
    case "three_scene":
      spec = { kind: widget.scene?.kind ?? "bar_landscape", literal: widget.scene?.data ?? [] };
      break;
    default:
      spec = {};
  }

  return {
    id: `${prefix}${widget.id.replace(/[^A-Za-z0-9_.:-]/g, "_")}`,
    kind: `legacy.${widget.type}`,
    title,
    rendererId,
    specVersion: "1",
    spec: spec as never,
    // Provenance in the fallback text is the only place a reader learns that
    // these values are a snapshot with no query behind them.
    fallback: [
      title,
      options.provenance ?? "widget snapshot",
      options.updatedAt ? `taken ${options.updatedAt}` : null,
    ]
      .filter(Boolean)
      .join(" — "),
  };
}

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
    const block = legacyWidgetToBlock(widget, {
      idPrefix: "legacy_",
      provenance: "imported from a legacy widget snapshot",
      ...(legacy?.updated_at ? { updatedAt: legacy.updated_at } : {}),
    });
    operations.push({ op: "block.add", sceneId, block });
  }

  return operations;
}
