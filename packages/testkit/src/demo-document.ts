import {
  createDocument,
  type DocumentPolicy,
  type Operation,
  type Transaction,
  type WorkplaneDocument,
} from "@bahulam/workplane-core";
import { ENVIRONMENTS, PERIODS, SOURCE_VERSION } from "./fixture.js";

export const DEMO_DOCUMENT_ID = "wp_azure_demo";

/**
 * Registered writable paths. Everything a user or agent may change is here,
 * typed and bounded; anything absent is rejected by the authority even for an
 * actor who may otherwise edit the document.
 */
export const DEMO_POLICY: DocumentPolicy = {
  structuralCapability: "workplane.edit",
  writablePaths: [
    { path: "/filters/period", schema: { type: "string", enum: [...PERIODS] } },
    { path: "/filters/environment", schema: { type: "string", enum: [...ENVIRONMENTS, "all"] } },
    {
      path: "/selection/services",
      schema: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 50 },
    },
    {
      path: "/assumptions/eligibleSharePercent",
      schema: { type: "number", minimum: 0, maximum: 100 },
    },
    {
      path: "/assumptions/reductionPercent",
      schema: { type: "number", minimum: 0, maximum: 100 },
    },
    /**
     * A nested write path. Scalar-only policies could not express this, which
     * is why the schema language replaced the type enum: a filter criterion is
     * an object, and it still has to be validated field by field at the
     * authority rather than trusted because it parsed as JSON.
     */
    {
      path: "/filters/criteria",
      schema: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          required: ["dimension", "operator", "values"],
          properties: {
            dimension: { type: "string", enum: ["service", "environment", "period"] },
            operator: { type: "string", enum: ["in", "not-in"] },
            values: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 25 },
          },
        },
      },
    },
  ],
};

export function createDemoDocument(): WorkplaneDocument {
  return createDocument({
    id: DEMO_DOCUMENT_ID,
    title: "Azure cost investigation",
    shared: {
      filters: { period: "2026-08", environment: "production" },
      selection: { services: [] },
      assumptions: { eligibleSharePercent: 60, reductionPercent: 20 },
    },
    dataSources: {
      azure_costs: {
        id: "azure_costs",
        provider: "synthetic.azure-cost",
        resource: "fixture/azure-costs",
        sourceVersion: SOURCE_VERSION,
        schema: {
          period: "string",
          environment: "string",
          service: "string",
          cost: "number",
        },
        sensitivity: "internal",
      },
    },
    queries: {
      total_spend: {
        id: "total_spend",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum" },
        parameters: {
          period: { scope: "shared", path: "/filters/period" },
          environment: { scope: "shared", path: "/filters/environment" },
        },
      },
      cost_by_service: {
        id: "cost_by_service",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum", dimension: "service" },
        parameters: {
          period: { scope: "shared", path: "/filters/period" },
          environment: { scope: "shared", path: "/filters/environment" },
        },
      },
      spend_trend: {
        id: "spend_trend",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum", dimension: "period" },
        parameters: {
          environment: { scope: "shared", path: "/filters/environment" },
        },
      },
      cost_detail: {
        id: "cost_detail",
        dataSourceId: "azure_costs",
        spec: { measure: "cost", aggregation: "sum", dimension: "service", detail: true },
        parameters: {
          period: { scope: "shared", path: "/filters/period" },
          environment: { scope: "shared", path: "/filters/environment" },
          services: { scope: "shared", path: "/selection/services" },
        },
      },
    },
  });
}

/**
 * The overview scene an agent would append on first run. Written as ordinary
 * operations so the scripted demo agent and a real one use the same path.
 */
export const OVERVIEW_OPERATIONS: readonly Operation[] = [
  { op: "scene.add", scene: { id: "overview", title: "Overview", layout: "grid" } },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "filters",
      kind: "input.filters",
      title: "Filters",
      rendererId: "workplane.form",
      specVersion: "1",
      spec: {
        fields: [
          {
            name: "period",
            label: "Billing period",
            control: "select",
            path: "/filters/period",
            options: PERIODS.map((p) => ({ value: p, label: p })),
          },
          {
            name: "environment",
            label: "Environment",
            control: "select",
            path: "/filters/environment",
            options: [
              ...ENVIRONMENTS.map((e) => ({ value: e, label: e })),
              { value: "all", label: "All environments" },
            ],
          },
        ],
        submitLabel: "Apply filters",
      },
      fallback: "Period and environment filters",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "total_spend_metric",
      kind: "content.metric",
      title: "Total spend",
      rendererId: "workplane.metric",
      specVersion: "1",
      spec: { queryId: "total_spend", column: "total", unit: "currency" },
      dataRefs: ["total_spend"],
      fallback: "Total spend for the selected period and environment",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "service_costs",
      kind: "analytics.chart",
      title: "Cost by service",
      rendererId: "workplane.echarts",
      specVersion: "1",
      spec: {
        chartType: "bar",
        queryId: "cost_by_service",
        categoryColumn: "service",
        entityColumn: "serviceId",
        valueColumn: "cost",
        entityType: "azure.service",
        /** Selecting here highlights this chart and filters the table. */
        selectionMode: "highlight",
        selectionPath: "/selection/services",
      },
      bindings: {
        selection: { scope: "shared", path: "/selection/services" },
      },
      dataRefs: ["cost_by_service"],
      fallback: "Bar chart of cost by Azure service",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "spend_trend_chart",
      kind: "analytics.chart",
      title: "Spend trend",
      rendererId: "workplane.echarts",
      specVersion: "1",
      spec: {
        chartType: "line",
        queryId: "spend_trend",
        categoryColumn: "period",
        valueColumn: "cost",
      },
      dataRefs: ["spend_trend"],
      fallback: "Line chart of total spend by billing period",
    },
  },
  {
    op: "block.add",
    sceneId: "overview",
    block: {
      id: "cost_table",
      kind: "analytics.table",
      title: "Cost detail",
      rendererId: "workplane.table",
      specVersion: "1",
      spec: {
        queryId: "cost_detail",
        columns: ["service", "environment", "period", "cost"],
        pageSize: 10,
      },
      dataRefs: ["cost_detail"],
      fallback: "Table of cost by service, environment, and period",
    },
  },
];

/** The comparison scene the scripted agent appends on request. */
export const SCENARIO_OPERATIONS: readonly Operation[] = [
  { op: "scene.add", scene: { id: "scenario", title: "Optimization scenario", layout: "grid" } },
  {
    op: "block.add",
    sceneId: "scenario",
    block: {
      id: "assumptions",
      kind: "input.form",
      title: "Assumptions",
      rendererId: "workplane.form",
      specVersion: "1",
      spec: {
        fields: [
          {
            name: "eligibleSharePercent",
            label: "Eligible share of spend (%)",
            control: "number",
            path: "/assumptions/eligibleSharePercent",
            min: 0,
            max: 100,
            step: 1,
          },
          {
            name: "reductionPercent",
            label: "Reduction applied (%)",
            control: "number",
            path: "/assumptions/reductionPercent",
            min: 0,
            max: 100,
            step: 1,
          },
        ],
        submitLabel: "Apply assumptions",
      },
      fallback: "Editable optimization assumptions",
    },
  },
  {
    op: "block.add",
    sceneId: "scenario",
    block: {
      id: "savings_metric",
      kind: "content.metric",
      title: "Projected savings",
      rendererId: "workplane.scenario",
      specVersion: "1",
      spec: { field: "savings", baselineQueryId: "total_spend" },
      bindings: {
        eligibleSharePercent: { scope: "shared", path: "/assumptions/eligibleSharePercent" },
        reductionPercent: { scope: "shared", path: "/assumptions/reductionPercent" },
      },
      dataRefs: ["total_spend"],
      fallback: "Projected savings under the current assumptions",
    },
  },
  {
    op: "block.add",
    sceneId: "scenario",
    block: {
      id: "projected_metric",
      kind: "content.metric",
      title: "Projected cost",
      rendererId: "workplane.scenario",
      specVersion: "1",
      spec: { field: "projectedCost", baselineQueryId: "total_spend" },
      bindings: {
        eligibleSharePercent: { scope: "shared", path: "/assumptions/eligibleSharePercent" },
        reductionPercent: { scope: "shared", path: "/assumptions/reductionPercent" },
      },
      dataRefs: ["total_spend"],
      fallback: "Projected cost under the current assumptions",
    },
  },
  {
    op: "block.add",
    sceneId: "scenario",
    block: {
      id: "scenario_fact",
      kind: "content.fact",
      title: "Summary",
      rendererId: "workplane.scenario",
      specVersion: "1",
      /**
       * A bound fact, not generated prose: every number is recomputed from the
       * same baseline and assumptions the metrics use, so changing an
       * assumption cannot leave a stale sentence behind.
       */
      spec: { field: "narrative", baselineQueryId: "total_spend" },
      bindings: {
        eligibleSharePercent: { scope: "shared", path: "/assumptions/eligibleSharePercent" },
        reductionPercent: { scope: "shared", path: "/assumptions/reductionPercent" },
      },
      dataRefs: ["total_spend"],
      fallback: "Narrative summary of the current scenario",
    },
  },
];

export function transaction(
  commandId: string,
  expectedRevision: number,
  operations: readonly Operation[],
): Transaction {
  return {
    protocolVersion: "workplane/1",
    documentId: DEMO_DOCUMENT_ID,
    commandId,
    expectedRevision,
    operations: [...operations],
  };
}
