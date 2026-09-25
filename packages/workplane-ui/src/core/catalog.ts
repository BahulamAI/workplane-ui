import type { JsonValue } from "../protocol/index.js";

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
  /** The spec shape in prose, for a reader skimming the catalog. */
  shape: string;
  /**
   * A REAL specification that this renderer accepts.
   *
   * Prose drifts from the validator and nothing notices; an example cannot,
   * because a contract test runs every one of these through the renderer it
   * claims to describe. It is also the more useful artefact: an agent copies a
   * working spec and edits it, rather than interpreting a description.
   */
  example: JsonValue;
  /** A second example where one shape is not enough to convey the choice. */
  alternateExample?: JsonValue;
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
    example: {
      markdown:
        "## Load balancers\n\nA load balancer spreads requests across **several** servers.\n\n" +
        "- Round robin\n- Least connections\n\n| Strategy | Cost |\n|---|---|\n| Round robin | low |",
    },
  },
  {
    id: "workplane.code",
    specVersions: ["1"],
    purpose: "A code sample, displayed and never executed.",
    shape: '{ code: "const x = 1;", language?: "typescript", caption?: "..." }',
    example: {
      code: "const region = process.env.AZURE_REGION;\nconsole.log(region);",
      language: "typescript",
      caption: "Reading the configured region",
    },
  },
  {
    id: "workplane.diagram",
    specVersions: ["1"],
    purpose:
      "A Mermaid diagram: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, " +
      "journey, gantt, mindmap, timeline. Use for architecture and flows. \"alt\" is REQUIRED: " +
      "describe what it shows, for readers who cannot see it.",
    shape:
      '{ diagram: "flowchart LR\\n  Client --> LB\\n  LB --> App", alt: "REQUIRED: what the diagram shows, ' +
      'for readers who cannot see it", caption?: "..." }',
    requires: "mermaid",
    example: {
      diagram: "flowchart LR\n  Client --> LB\n  LB --> App1\n  LB --> App2",
      alt: "A client reaching two application servers through a load balancer",
    },
  },
  {
    id: "workplane.text",
    specVersions: ["1"],
    purpose: "A single plain paragraph. Prefer workplane.markdown unless the text is genuinely plain.",
    shape: '{ text: "...", generated?: boolean }',
    example: { text: "Costs are reported in the subscription's billing currency." },
  },
  {
    id: "workplane.fact",
    specVersions: ["1"],
    purpose:
      "A sentence whose numbers come from live bindings, so it cannot drift out of agreement with the data.",
    shape: '{ template: "Reducing {rate}% of {baseline} saves {saved}." } with matching block bindings',
    example: { template: "Reducing {reductionPercent}% saves {savings}." },
  },
  {
    id: "workplane.metric",
    specVersions: ["1"],
    purpose:
      "One headline number, from a query or inline. Inline money is INTEGER MINOR UNITS: " +
      "1423.57 is sent as 142357.",
    shape:
      '{ queryId: "q", column: "total" }  OR  { value: 142357, currency: "USD" } ' +
      "— inline money is INTEGER MINOR UNITS, so 1423.57 is sent as 142357",
    example: { queryId: "total_spend", column: "total" },
    alternateExample: { value: 142357, currency: "USD" },
  },
  {
    id: "workplane.table",
    specVersions: ["1"],
    purpose:
      "Rows and columns, from a query or inline. Inline money columns are INTEGER MINOR UNITS " +
      "and must be named in moneyColumns.",
    shape:
      '{ queryId: "q", columns: ["a","b"], pageSize: 12 }  OR  ' +
      '{ columns: ["Service","Cost"], rows: [["Compute", 41230]], moneyColumns: ["Cost"], currency: "USD" }',
    example: { queryId: "cost_detail", columns: ["service", "cost"], pageSize: 12 },
    alternateExample: {
      columns: ["Service", "Cost"],
      rows: [["Container Apps", 5173448], ["Virtual Machines", 2013639]],
      moneyColumns: ["Cost"],
      currency: "INR",
      pageSize: 12,
    },
  },
  {
    id: "workplane.echarts",
    specVersions: ["1"],
    purpose:
      "A chart. Send an ECharts option: multi-series, dashed lines and per-series colour are ECharts' " +
      "own vocabulary. Line series must differ by lineStyle.type or symbol, not colour alone. " +
      "Axes, grid and series accept a single object or an array.",
    shape:
      '{ option: { xAxis: [{ type: "category", data: [...] }], yAxis: [{ type: "value" }], ' +
      'series: [{ name: "Actual", type: "line", data: [...], lineStyle: { type: "solid" } }, ' +
      '{ name: "Projected", type: "line", data: [...], lineStyle: { type: "dashed" } }] }, ' +
      'bind?: { queryId: "q", categoryColumn: "c", series: [{ index: 0, valueColumn: "v" }] } }',
    requires: "echarts",
    example: {
      option: {
        xAxis: [{ type: "category", data: ["Jul", "Aug", "Sep"] }],
        yAxis: [{ type: "value" }],
        legend: { show: true },
        series: [
          { name: "Actual", type: "line", data: [94000, 108500, 71016], lineStyle: { type: "solid" } },
          { name: "Projected", type: "line", data: [null, null, 93000], lineStyle: { type: "dashed" } },
        ],
      },
    },
    alternateExample: {
      option: { xAxis: [{ type: "category" }], yAxis: [{ type: "value" }], series: [{ type: "bar" }] },
      bind: { queryId: "cost_by_service", categoryColumn: "service", series: [{ index: 0, valueColumn: "cost" }] },
    },
  },
  {
    id: "workplane.form",
    specVersions: ["1"],
    purpose:
      "Typed inputs. Each field writes to a path the plugin declared writable; anything else is refused.",
    shape:
      '{ fields: [{ name: "days", label: "Days", control: "number"|"text"|"select"|"checkbox", ' +
      'path: "/filters/days", min?, max?, options?: [{value,label}] }], submitLabel: "Apply" }',
    example: {
      fields: [
        { name: "days", label: "Look back (days)", control: "number", path: "/filters/days", min: 1, max: 365 },
      ],
      submitLabel: "Apply",
    },
  },
  {
    id: "workplane.button",
    specVersions: ["1"],
    purpose:
      "Requests a registered host action. Carries an action id and typed arguments — never a URL, " +
      "a command, or a tool name.",
    shape: '{ actionId: "check_answer", label: "Check", arguments?: { choice: "b" }, confirm?: "..." }',
    example: { actionId: "check_answer", label: "Check my answer", arguments: { choice: "b" } },
  },
];

/** Compact rendering of the catalog for a tool description or agent context. */
export function describeCatalog(renderers: readonly RendererDescriptor[] = BUILTIN_RENDERERS): string {
  return renderers
    .map((r) => {
      const lines = [
        `  ${r.id}${r.requires ? ` (needs ${r.requires})` : ""}`,
        `    ${r.purpose}`,
        // The example is the contract. It is tested against the renderer, so
        // unlike the prose it cannot quietly stop being true.
        `    example: ${JSON.stringify(r.example)}`,
      ];
      if (r.alternateExample) lines.push(`    or: ${JSON.stringify(r.alternateExample)}`);
      return lines.join("\n");
    })
    .join("\n");
}
