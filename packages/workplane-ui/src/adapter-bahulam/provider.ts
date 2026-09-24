import { parameterFingerprint, type DataProvider, type QueryRequest, type QueryResult, type ResultColumn } from "../data/index.js";
import type { JsonObject, JsonValue } from "../protocol/index.js";
import type { BahulamClient } from "./client.js";

export interface ShapedResult {
  columns: ResultColumn[];
  rows: JsonValue[][];
  rowCount?: number;
  rowCountIsEstimate?: boolean;
  sourceVersion?: string;
}

/**
 * Maps one Workplane query onto one declared plugin tool.
 *
 * `shape` is where a tool's ad-hoc output becomes a typed result: it declares
 * column types, units, currency, and aggregation. That declaration has to
 * happen here, at the provider boundary, because a renderer must never be left
 * to guess whether a number is a sum, an average, or a ratio.
 */
export interface ToolQueryBinding {
  queryId: string;
  /** Name of a tool declared in plugin.yaml. */
  tool: string;
  /** Translate resolved Workplane parameters into tool arguments. */
  args?: (parameters: JsonObject) => Record<string, unknown>;
  shape: (output: unknown, parameters: JsonObject) => ShapedResult;
  /** Authorization partition for the cache key. */
  partition?: (parameters: JsonObject) => string;
}

export interface PluginToolDataProviderOptions {
  client: BahulamClient;
  bindings: readonly ToolQueryBinding[];
  /** Called on every tool execution — useful for a visible query counter. */
  onExecute?: (queryId: string, tool: string) => void;
}

/**
 * A `DataProvider` backed by the plugin's own tools.
 *
 * The important property is what does NOT pass through here: a tool reads its
 * credentials from plugin config inside the host process, so no secret reaches
 * the browser, the document, or the agent context. This provider sends
 * parameters and receives rows.
 */
export class PluginToolDataProvider implements DataProvider {
  readonly id: string;
  readonly #client: BahulamClient;
  readonly #bindings: Map<string, ToolQueryBinding>;
  readonly #onExecute: ((queryId: string, tool: string) => void) | undefined;
  #executions = 0;

  constructor(options: PluginToolDataProviderOptions) {
    this.#client = options.client;
    this.id = `bahulam.plugin.${options.client.plugin}`;
    this.#bindings = new Map(options.bindings.map((b) => [b.queryId, b]));
    this.#onExecute = options.onExecute;
  }

  get executionCount(): number {
    return this.#executions;
  }

  async execute(request: QueryRequest): Promise<QueryResult> {
    const binding = this.#bindings.get(request.queryId);
    if (!binding) {
      throw new Error(`No tool is bound to query "${request.queryId}"`);
    }

    this.#executions += 1;
    this.#onExecute?.(request.queryId, binding.tool);

    const args = binding.args ? binding.args(request.parameters) : {};
    const raw = await this.#client.executeTool<{ output?: unknown } | unknown>(binding.tool, args);

    // A superseded request is discarded by the coordinator on generation, but
    // there is no reason to keep shaping a result nobody will read.
    if (request.signal?.aborted) {
      throw new Error("aborted");
    }

    // Bahulam tools return `{success, output}`. A failed tool puts its ERROR in
    // `output`, so unwrapping without checking `success` would shape an error
    // object into empty rows and render a confident zero. Surface it instead:
    // a missing credential must look like a failure, never like no spend.
    const envelope = raw as { success?: boolean; output?: unknown } | undefined;
    if (envelope && typeof envelope === "object" && envelope.success === false) {
      const detail = envelope.output;
      const message =
        typeof detail === "string"
          ? detail
          : typeof (detail as { message?: string })?.message === "string"
            ? (detail as { message: string }).message
            : `Tool "${binding.tool}" reported failure`;
      throw new Error(message);
    }
    const output =
      envelope && typeof envelope === "object" && "output" in envelope
        ? envelope.output
        : raw;

    const shaped = binding.shape(output, request.parameters);
    const partition = binding.partition?.(request.parameters) ?? "default";

    return {
      resultId: `res_${request.queryId}_${request.generation}`,
      queryId: request.queryId,
      sourceVersion: shaped.sourceVersion ?? "plugin-tool",
      parameterFingerprint: parameterFingerprint(request.parameters, partition),
      partition,
      executedAt: new Date().toISOString(),
      columns: shaped.columns,
      rows: shaped.rows,
      rowCount: shaped.rowCount ?? shaped.rows.length,
      rowCountIsEstimate: shaped.rowCountIsEstimate ?? false,
      freshness: "fresh",
      generation: request.generation,
    };
  }
}

/**
 * Convert a floating-point currency amount into integer minor units.
 *
 * Tool outputs carry values like `412.30`. Rounding happens here, once, at the
 * declared boundary — not separately inside each renderer.
 */
export function toMinorUnits(amount: unknown, scale = 2): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10 ** scale);
}
