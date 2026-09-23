import {
  DependencyGraph,
  QueryCoordinator,
  type DataProvider,
  type EpochState,
  type QueryResult,
} from "@bahulam/workplane-data";
import {
  getPointer,
  type Actor,
  type CommittedEvent,
  type JsonObject,
  type JsonValue,
  type Operation,
  type Transaction,
} from "@bahulam/workplane-protocol";
import { PROTOCOL_VERSION } from "@bahulam/workplane-protocol";
import type { WorkplaneDocument } from "./document.js";
import type { CommandGateway, CommitResult } from "./gateway.js";
import { SessionStore } from "./session.js";

export interface ControllerOptions {
  gateway: CommandGateway;
  documentId: string;
  actor: Actor;
  provider: DataProvider;
  session?: SessionStore;
  /** Trailing debounce for expensive reads. */
  debounceMs?: number;
  /** Injected for deterministic tests. */
  commandId?: () => string;
}

export interface ControllerState {
  document: WorkplaneDocument | undefined;
  epoch: EpochState;
}

let commandCounter = 0;

/**
 * Ties the authority, the session, and the query coordinator together.
 *
 * Deliberately framework-free: state is read through `getState()` and changes
 * are announced through `subscribe()`, which is exactly the shape
 * `useSyncExternalStore` wants and exactly what a non-React wrapper needs. No
 * hook, component, or DOM node appears below this line.
 */
export class WorkplaneController {
  readonly session: SessionStore;
  readonly #gateway: CommandGateway;
  readonly #documentId: string;
  readonly #actor: Actor;
  readonly #graph = new DependencyGraph();
  readonly #coordinator: QueryCoordinator;
  readonly #listeners = new Set<() => void>();
  readonly #nextCommandId: () => string;
  #unsubscribeGateway: (() => void) | undefined;

  #document: WorkplaneDocument | undefined;
  #epoch: EpochState = { epoch: 0, results: new Map(), pending: new Set(), stale: false };
  #state: ControllerState = { document: undefined, epoch: this.#epoch };

  constructor(options: ControllerOptions) {
    this.#gateway = options.gateway;
    this.#documentId = options.documentId;
    this.#actor = options.actor;
    this.session = options.session ?? new SessionStore();
    this.#nextCommandId =
      options.commandId ?? (() => `cmd_${Date.now().toString(36)}_${(++commandCounter).toString(36)}`);

    this.#coordinator = new QueryCoordinator({
      provider: options.provider,
      debounceMs: options.debounceMs ?? 250,
      onPublish: (epoch) => {
        this.#epoch = epoch;
        this.#publish();
      },
    });
  }

  // --- external store contract -------------------------------------------
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getState = (): ControllerState => this.#state;

  #publish(): void {
    // A NEW object identity every publish, so `useSyncExternalStore` sees the
    // change; the members themselves are structurally shared.
    this.#state = { document: this.#document, epoch: this.#epoch };
    for (const listener of this.#listeners) listener();
  }

  // --- lifecycle ----------------------------------------------------------
  async load(): Promise<void> {
    this.#document = await this.#gateway.snapshot(this.#documentId);
    this.#reindex();
    this.#unsubscribeGateway?.();
    this.#unsubscribeGateway = this.#gateway.subscribe((event, document) => {
      if (document.id !== this.#documentId) return;
      this.#document = document;
      this.#reindex();
      this.#publish();
      void this.#refreshFor(event.operations);
    });
    this.#publish();
    await this.#coordinator.runNow(this.#planAll());
  }

  dispose(): void {
    this.#unsubscribeGateway?.();
    this.#coordinator.dispose();
    this.#listeners.clear();
  }

  // --- reads --------------------------------------------------------------
  get document(): WorkplaneDocument | undefined {
    return this.#document;
  }

  get revision(): number {
    return this.#document?.revision ?? 0;
  }

  getResult(queryId: string): QueryResult | undefined {
    return this.#epoch.results.get(queryId);
  }

  /** Resolve a binding against committed state. Renderers never read raw. */
  resolveBinding(path: string): JsonValue | undefined {
    if (!this.#document) return undefined;
    return getPointer(this.#document.shared, path);
  }

  // --- writes -------------------------------------------------------------
  /**
   * Commit operations. Every durable change from this client goes here —
   * there is no second path, and the renderer registry has no way to reach the
   * gateway directly.
   */
  async commit(operations: readonly Operation[]): Promise<CommitResult> {
    if (!this.#document) {
      throw new Error("Controller has no document. Call load() first.");
    }
    const transaction: Transaction = {
      protocolVersion: PROTOCOL_VERSION,
      documentId: this.#documentId,
      commandId: this.#nextCommandId(),
      expectedRevision: this.#document.revision,
      operations: [...operations],
    };
    const result = await this.#gateway.commit(transaction, this.#actor);
    if (result.ok) {
      this.#document = result.document;
      this.#reindex();
      this.#publish();
      await this.#refreshFor(operations);
    }
    return result;
  }

  /** Convenience for a single committed value change. */
  async setSharedValue(path: string, value: JsonValue): Promise<CommitResult> {
    return this.commit([{ op: "state.set", path, value }]);
  }

  // --- dependency evaluation ---------------------------------------------
  #reindex(): void {
    const document = this.#document;
    if (!document) return;

    for (const [queryId, query] of Object.entries(document.queries)) {
      this.#graph.registerQuery({
        queryId,
        dependsOnPaths: Object.values(query.parameters)
          .filter((binding) => binding.scope === "shared")
          .map((binding) => binding.path),
      });
    }
    for (const [blockId, block] of Object.entries(document.blocks)) {
      this.#graph.registerBlock({
        blockId,
        dependsOnPaths: Object.values(block.bindings)
          .filter((binding) => binding.scope === "shared")
          .map((binding) => binding.path),
        dependsOnQueries: block.dataRefs,
      });
    }
  }

  #resolveParameters(queryId: string): JsonObject {
    const document = this.#document;
    const query = document?.queries[queryId];
    if (!document || !query) return {};
    const parameters: JsonObject = {};
    for (const [name, binding] of Object.entries(query.parameters)) {
      if (binding.scope !== "shared") continue;
      const value = getPointer(document.shared, binding.path);
      if (value !== undefined) parameters[name] = value;
    }
    return parameters;
  }

  #planAll() {
    const document = this.#document;
    if (!document) return [];
    return Object.keys(document.queries).map((queryId) => ({
      queryId,
      spec: document.queries[queryId]?.spec,
      parameters: this.#resolveParameters(queryId),
    }));
  }

  /**
   * Re-run only the queries a change actually invalidated, as one coherent
   * group. This is the path that must NOT involve the model: a filter commit
   * lands here and nowhere near an agent.
   */
  async #refreshFor(operations: readonly Operation[]): Promise<void> {
    const document = this.#document;
    if (!document) return;

    const changedPaths = operations
      .filter((op): op is Extract<Operation, { op: "state.set" }> => op.op === "state.set")
      .map((op) => op.path);

    const structural = operations.some((op) => op.op !== "state.set");
    if (structural && changedPaths.length === 0) {
      // New blocks may reference queries that have never run.
      const missing = this.#planAll().filter((plan) => !this.#epoch.results.has(plan.queryId));
      if (missing.length > 0) await this.#coordinator.runNow(missing);
      return;
    }

    const queryIds = new Set<string>();
    for (const path of changedPaths) {
      for (const queryId of this.#graph.queriesAffectedBy(path)) queryIds.add(queryId);
    }
    if (queryIds.size === 0) return;

    this.#coordinator.request(
      [...queryIds].map((queryId) => ({
        queryId,
        spec: document.queries[queryId]?.spec,
        parameters: this.#resolveParameters(queryId),
      })),
    );
  }

  /** Blocks that must repaint together for a given change. */
  coherenceGroupFor(path: string): { blocks: string[]; queries: string[] } {
    return this.#graph.coherenceGroupFor(path);
  }

  async eventsAfter(revision: number): Promise<CommittedEvent[]> {
    return this.#gateway.eventsAfter(this.#documentId, revision);
  }
}
