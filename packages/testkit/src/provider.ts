import type { DataProvider, QueryRequest, QueryResult, ResultColumn } from "@bahulam/workplane-data";
import { parameterFingerprint } from "@bahulam/workplane-data";
import type { JsonValue } from "@bahulam/workplane-protocol";
import { COST_ROWS, CURRENCY, SERVICE_LABELS, SOURCE_VERSION } from "./fixture.js";

export interface SyntheticProviderOptions {
  /** Artificial latency, for exercising late-result handling in tests. */
  latencyMs?: number | ((request: QueryRequest) => number);
  /** Called on every execution. Tests assert the count; the demo shows it. */
  onExecute?: (request: QueryRequest) => void;
}

const MONEY_COLUMN = (name: string): ResultColumn => ({
  name,
  type: "money",
  currency: CURRENCY,
  aggregation: "sum",
});

/**
 * Deterministic TypeScript over a small fixture — no database, no network, no
 * credential. Column semantics (unit, currency, aggregation) are declared
 * here, at the provider, so no renderer has to guess whether a number is a sum
 * or an average.
 */
export class SyntheticCostProvider implements DataProvider {
  readonly id = "synthetic.azure-cost";
  #options: SyntheticProviderOptions;
  #executions = 0;

  constructor(options: SyntheticProviderOptions = {}) {
    this.#options = options;
  }

  get executionCount(): number {
    return this.#executions;
  }

  resetExecutionCount(): void {
    this.#executions = 0;
  }

  async execute(request: QueryRequest): Promise<QueryResult> {
    this.#executions += 1;
    this.#options.onExecute?.(request);

    const latency =
      typeof this.#options.latencyMs === "function"
        ? this.#options.latencyMs(request)
        : this.#options.latencyMs ?? 0;
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));

    const period = String(request.parameters.period ?? "2026-08");
    const environment = String(request.parameters.environment ?? "production");
    const rows = COST_ROWS.filter(
      (row) => row.period === period && (environment === "all" || row.environment === environment),
    );

    const base = {
      queryId: request.queryId,
      sourceVersion: SOURCE_VERSION,
      parameterFingerprint: parameterFingerprint(request.parameters, `env:${environment}`),
      partition: `env:${environment}`,
      executedAt: new Date(0).toISOString(),
      rowCountIsEstimate: false,
      freshness: "fresh" as const,
      generation: request.generation,
    };

    switch (request.queryId) {
      case "cost_by_service": {
        const totals = new Map<string, number>();
        for (const row of rows) {
          totals.set(row.service, (totals.get(row.service) ?? 0) + row.costMinorUnits);
        }
        const data: JsonValue[][] = [...totals.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([service, minorUnits]) => [service, SERVICE_LABELS[service] ?? service, minorUnits]);
        return {
          ...base,
          resultId: `res_${request.queryId}_${base.parameterFingerprint}`,
          columns: [
            { name: "serviceId", type: "string" },
            { name: "service", type: "string" },
            MONEY_COLUMN("cost"),
          ],
          rows: data,
          rowCount: data.length,
        };
      }

      case "total_spend": {
        const total = rows.reduce((sum, row) => sum + row.costMinorUnits, 0);
        return {
          ...base,
          resultId: `res_${request.queryId}_${base.parameterFingerprint}`,
          columns: [MONEY_COLUMN("total")],
          rows: [[total]],
          rowCount: 1,
        };
      }

      case "spend_trend": {
        const data: JsonValue[][] = [];
        for (const trendPeriod of ["2026-07", "2026-08"]) {
          const total = COST_ROWS.filter(
            (row) =>
              row.period === trendPeriod &&
              (environment === "all" || row.environment === environment),
          ).reduce((sum, row) => sum + row.costMinorUnits, 0);
          data.push([trendPeriod, total]);
        }
        return {
          ...base,
          resultId: `res_${request.queryId}_${base.parameterFingerprint}`,
          columns: [{ name: "period", type: "string" }, MONEY_COLUMN("cost")],
          rows: data,
          rowCount: data.length,
        };
      }

      case "cost_detail": {
        const selected = Array.isArray(request.parameters.services)
          ? (request.parameters.services as string[])
          : [];
        const filtered = selected.length > 0
          ? rows.filter((row) => selected.includes(row.service))
          : rows;
        const data: JsonValue[][] = filtered
          .slice()
          .sort((a, b) => b.costMinorUnits - a.costMinorUnits)
          .map((row) => [
            row.service,
            SERVICE_LABELS[row.service] ?? row.service,
            row.environment,
            row.period,
            row.costMinorUnits,
          ]);
        return {
          ...base,
          resultId: `res_${request.queryId}_${base.parameterFingerprint}`,
          columns: [
            { name: "serviceId", type: "string" },
            { name: "service", type: "string" },
            { name: "environment", type: "string" },
            { name: "period", type: "string" },
            MONEY_COLUMN("cost"),
          ],
          rows: data,
          rowCount: data.length,
        };
      }

      default:
        throw new Error(`Unknown query "${request.queryId}"`);
    }
  }
}
