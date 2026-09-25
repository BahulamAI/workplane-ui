/**
 * What renderers exist, described without importing any of them.
 *
 * The host has to tell an agent what it may draw with, and the host is headless
 * — it cannot import the React renderers to ask them. So the descriptions live
 * here, in core, and a contract test asserts every registered renderer appears
 * with matching capabilities. Two hand-maintained lists would drift, and the
 * drift would surface as an agent confidently using a renderer that is not
 * installed.
 */
export interface RendererDescriptor {
  id: string;
  specVersions: readonly string[];
  /** One line an agent reads to decide whether this is the right block. */
  purpose: string;
  /** The spec shape, written as an agent would send it. */
  shape: string;
  /** Peer dependency a host must install for this renderer to work. */
  requires?: string;
}

export const BUILTIN_RENDERERS: readonly RendererDescriptor[] = [
  {
    id: "workplane.markdown",
    specVersions: ["1"],
    purpose:
      "Prose with structure: headings, lists, tables, blockquotes, fenced code, emphasis. " +
      "The default choice for explanation.",
    shape: '{ markdown: "# Title\\n\\nText with **bold**, `code`, - lists, and | tables |", generated?: boolean }',
  },
  {
    id: "workplane.code",
    specVersions: ["1"],
    purpose: "A code sample, displayed and never executed.",
    shape: '{ code: "const x = 1;", language?: "typescript", caption?: "..." }',
  },
  {
    id: "workplane.diagram",
    specVersions: ["1"],
    purpose:
      "A Mermaid diagram: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, " +
      "journey, gantt, mindmap, timeline. Use for architecture and flows.",
    shape:
      '{ diagram: "flowchart LR\\n  Client --> LB\\n  LB --> App", alt: "REQUIRED: what the diagram shows, ' +
      'for readers who cannot see it", caption?: "..." }',
    requires: "mermaid",
  },
  {
    id: "workplane.text",
    specVersions: ["1"],
    purpose: "A single plain paragraph. Prefer workplane.markdown unless the text is genuinely plain.",
    shape: '{ text: "...", generated?: boolean }',
  },
  {
    id: "workplane.fact",
    specVersions: ["1"],
    purpose:
      "A sentence whose numbers come from live bindings, so it cannot drift out of agreement with the data.",
    shape: '{ template: "Reducing {rate}% of {baseline} saves {saved}." } with matching block bindings',
  },
  {
    id: "workplane.metric",
    specVersions: ["1"],
    purpose: "One headline number, from a query or inline.",
    shape:
      '{ queryId: "q", column: "total" }  OR  { value: 142357, currency: "USD" } ' +
      "— inline money is INTEGER MINOR UNITS, so 1423.57 is sent as 142357",
  },
  {
    id: "workplane.table",
    specVersions: ["1"],
    purpose: "Rows and columns, from a query or inline.",
    shape:
      '{ queryId: "q", columns: ["a","b"], pageSize: 12 }  OR  ' +
      '{ columns: ["Service","Cost"], rows: [["Compute", 41230]], moneyColumns: ["Cost"], currency: "USD" }',
  },
  {
    id: "workplane.echarts",
    specVersions: ["1"],
    purpose:
      "A chart. Send an ECharts option: multi-series, dashed lines and per-series colour are ECharts' " +
      "own vocabulary. Line series must differ by lineStyle.type or symbol, not colour alone.",
    shape:
      '{ option: { xAxis: [{ type: "category", data: [...] }], yAxis: [{ type: "value" }], ' +
      'series: [{ name: "Actual", type: "line", data: [...], lineStyle: { type: "solid" } }, ' +
      '{ name: "Projected", type: "line", data: [...], lineStyle: { type: "dashed" } }] }, ' +
      'bind?: { queryId: "q", categoryColumn: "c", series: [{ index: 0, valueColumn: "v" }] } }',
    requires: "echarts",
  },
  {
    id: "workplane.form",
    specVersions: ["1"],
    purpose:
      "Typed inputs. Each field writes to a path the plugin declared writable; anything else is refused.",
    shape:
      '{ fields: [{ name: "days", label: "Days", control: "number"|"text"|"select"|"checkbox", ' +
      'path: "/filters/days", min?, max?, options?: [{value,label}] }], submitLabel: "Apply" }',
  },
  {
    id: "workplane.button",
    specVersions: ["1"],
    purpose:
      "Requests a registered host action. Carries an action id and typed arguments — never a URL, " +
      "a command, or a tool name.",
    shape: '{ actionId: "check_answer", label: "Check", arguments?: { choice: "b" }, confirm?: "..." }',
  },
];

/** Compact rendering of the catalog for a tool description or agent context. */
export function describeCatalog(renderers: readonly RendererDescriptor[] = BUILTIN_RENDERERS): string {
  return renderers
    .map((r) => `  ${r.id}${r.requires ? ` (needs ${r.requires})` : ""}\n    ${r.purpose}\n    spec: ${r.shape}`)
    .join("\n");
}
