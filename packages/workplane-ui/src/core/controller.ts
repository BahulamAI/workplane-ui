import {
  DependencyGraph,
  QueryCoordinator,
  type DataProvider,
  type EpochState,
  type QueryResult,
} from "../data/index.js";
import {
  getPointer,
  type Actor,
  type CommittedEvent,
  type JsonObject,
  type JsonValue,
  type Operation,
  type Transaction,
} from "../protocol/index.js";
import { PROTOCOL_VERSION } from "../protocol/index.js";
import type { WorkplaneDocument } from "./document.js";
import type {
  ActionBroker, ActionOutcome, ActionRequest, HistoryListing, HistoryPort, RevisionView,
} from "./host.js";
import type { CommandGateway, CommitResult } from "./gateway.js";
import { SessionStore } from "./session.js";
import {
  describeRestore, diffDocuments, restoreOperations,
  type DocumentDiff, type RestorePlan,
} from "./history.js";

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
  /**
   * Registered host actions. Absent means a block that requests one gets an
   * explicit unsupported result rather than a silent no-op — PRD section 12.1.
   */
  actions?: ActionBroker;
  /**
   * Reading past revisions. Absent means the History domain is unavailable with
   * a stated reason — section 5.4.6 navigation needs checkpoints the client
   * cannot reconstruct on its own.
   */
  history?: HistoryPort;
}

export interface PreviewState {
  /** The revision being looked at. */
  revision: number;
  /** Where live actually is, so the UI can say how far back this is. */
  liveRevision: number;
  /** What differs from live, when the host computed it. */
  diff?: DocumentDiff | null;
}

export interface ControllerState {
  document: WorkplaneDocument | undefined;
  epoch: EpochState;
  /**
   * Set while looking at a past revision. Its presence means EVERYTHING is
   * read-only: `document` is a reconstruction, no query is running, and any
   * write or action is refused by the controller rather than merely hidden.
   */
  preview?: PreviewState;
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
  readonly #actions: ActionBroker | undefined;
  readonly #history: HistoryPort | undefined;
  #unsubscribeGateway: (() => void) | undefined;

  /** The live head. Never replaced by a reconstruction. */
  #document: WorkplaneDocument | undefined;
  /** A past revision being looked at, alongside — not instead of — the head. */
  #preview: { state: PreviewState; document: WorkplaneDocument } | undefined;
  #epoch: EpochState = { epoch: 0, results: new Map(), pending: new Set(), stale: false, errors: new Map() };
  #state: ControllerState = { document: undefined, epoch: this.#epoch };

  constructor(options: ControllerOptions) {
    this.#gateway = options.gateway;
    this.#documentId = options.documentId;
    this.#actor = options.actor;
    this.session = options.session ?? new SessionStore();
    this.#nextCommandId =
      options.commandId ?? (() => `cmd_${Date.now().toString(36)}_${(++commandCounter).toString(36)}`);
    this.#actions = options.actions;
    this.#history = options.history;

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
    // While previewing, the DISPLAYED document is the reconstruction — so every
    // presenter and renderer works unchanged — but the head is kept separately
    // so a commit still knows the real revision it would be racing.
    this.#state = this.#preview
      ? { document: this.#preview.document, epoch: this.#epoch, preview: this.#preview.state }
      : { document: this.#document, epoch: this.#epoch };
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
      if (this.#preview) {
        // A commit landing while someone reads history must not replace what
        // they are reading. Record that live moved on and leave the view alone.
        this.#preview = {
          ...this.#preview,
          state: { ...this.#preview.state, liveRevision: document.revision },
        };
        this.#publish();
        return;
      }
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
    // Section 5.4.6: looking at a historical revision changes the preview only.
    // Enforced here rather than by hiding controls — a renderer, an embedded
    // form, or a host's own button would otherwise still reach the gateway, and
    // the commit would silently apply to LIVE while the reader looked at the
    // past. Restoring is a separate, explicit call.
    if (this.#preview) {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message:
            `This is revision ${this.#preview.state.revision}, a past state of the document. ` +
            "Return to the current revision to make changes, or restore this one, " +
            "which creates a new revision.",
          correlationId: this.#nextCommandId(),
          // Retrying the same commit will fail the same way until the reader
          // leaves history, so this is not a rebase.
          retry: "do-not-retry",
        },
      };
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

  /**
   * Request a registered action.
   *
   * Routed through the host broker, which applies the same policy to a click
   * and to an agent proposal — AC-10. A renderer cannot reach the broker
   * directly; it emits an intent and this decides.
   */
  async requestAction(request: ActionRequest): Promise<ActionOutcome | { status: "unsupported"; reason: string }> {
    if (this.#preview) {
      // "Pressing Next changes the preview only and cannot change live
      // assumptions or execute a render job" — section 5.4 acceptance.
      return {
        status: "unsupported",
        reason:
          `Actions are unavailable while viewing revision ${this.#preview.state.revision}. ` +
          "A past revision is a record, not a live workspace.",
      };
    }
    if (!this.#actions) {
      return {
        status: "unsupported",
        reason:
          "This host registers no actions, so nothing can be requested. " +
          "A plugin declares actions in its manifest.",
      };
    }
    return this.#actions.request(request);
  }

  /** Registered actions, for showing what a document may ask for. */
  async availableActions(): Promise<ReadonlyArray<{ actionId: string; summary: string }>> {
    return this.#actions ? this.#actions.listRegistered() : [];
  }

  /** Convenience for a single committed value change. */
  async setSharedValue(path: string, value: JsonValue): Promise<CommitResult> {
    return this.commit([{ op: "state.set", path, value }]);
  }


  // --- history navigation (section 5.4.6) ---------------------------------

  /** Whether this host can serve past revisions at all. */
  get historyAvailable(): boolean {
    return this.#history !== undefined;
  }

  /** The commit log, or a stated reason it is unavailable. */
  async historyEntries(options?: { limit?: number }): Promise<HistoryListing | { unavailable: string }> {
    if (!this.#history) {
      return {
        unavailable:
          "This host does not serve document history. Rebuilding a past revision needs " +
          "checkpoints, which only the host has.",
      };
    }
    return this.#history.entries(this.#documentId, options);
  }

  /**
   * Look at a past revision.
   *
   * Returns the host's typed refusal unchanged when reconstruction is not
   * possible — history compacted past this point, a gap in the event log, a
   * replay that failed. Refusing beats showing a document that is quietly wrong,
   * because someone will compare it against live data and trust the difference.
   */
  async enterHistory(revision: number): Promise<RevisionView> {
    if (!this.#history) {
      return { ok: false, reason: "unavailable", message: "This host does not serve document history." };
    }
    if (!this.#document) throw new Error("Controller has no document. Call load() first.");
    if (revision === this.#document.revision) {
      // Asking for the current revision is a return to live, not a preview of
      // something identical that happens to be read-only.
      this.returnToLive();
      return { ok: true, document: this.#document, diff: null };
    }

    const view = await this.#history.at(this.#documentId, revision);
    if (!view.ok) return view;

    this.#preview = {
      document: view.document,
      state: {
        revision,
        liveRevision: this.#document.revision,
        ...(view.diff !== undefined ? { diff: view.diff } : {}),
      },
    };
    // No query runs and no epoch advances: the results on screen belong to live
    // data, and re-running them against a historical document would produce a
    // mixture of two moments that looks like neither.
    this.session.patchViewState({ navigationDomain: "history", historyRevision: revision });
    this.#publish();
    return view;
  }

  /** Back to the current revision, and back to being writable. */
  returnToLive(): void {
    if (!this.#preview) return;
    this.#preview = undefined;
    this.session.patchViewState({ navigationDomain: "scenes", historyRevision: null });
    this.#reindex();
    this.#publish();
    void this.#coordinator.runNow(this.#planAll());
  }

  /**
   * What restoring the previewed revision would do, without doing it.
   *
   * Section 5.4.6 makes correct restoration semantics mandatory BEFORE a restore
   * control is offered, so the plan and its description are computed separately
   * from applying them and are meant to be shown to the user first.
   */
  planRestore(): { plan: RestorePlan; diff: DocumentDiff; description: string[] } | undefined {
    if (!this.#preview || !this.#document) return undefined;
    const target = this.#preview.document;
    const plan = restoreOperations(this.#document, target);
    const diff = diffDocuments(target, this.#document);
    return { plan, diff, description: describeRestore(plan, diff) };
  }

  /**
   * Restore the previewed revision as a NEW commit.
   *
   * History is never rewritten — section 9.5. Structural operations and shared
   * values commit together as one transaction, so a restore either happens or
   * does not; a partial restore is a document in a state no revision ever had.
   */
  async restorePreviewed(): Promise<CommitResult> {
    const planned = this.planRestore();
    if (!planned) {
      throw new Error("Nothing to restore: no revision is being previewed.");
    }
    const operations = [...planned.plan.structural, ...planned.plan.shared];
    if (operations.length === 0) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "This revision is identical to the current document; there is nothing to restore.",
          correlationId: this.#nextCommandId(),
          retry: "do-not-retry",
        },
      };
    }
    // Leave the preview first: the commit must be judged against live, and
    // `commit` refuses while previewing by design.
    const revision = planned.diff.fromRevision;
    this.returnToLive();
    const result = await this.commit(operations);
    if (!result.ok) {
      // Put the reader back where they were, so a refusal is not also a
      // navigation they did not ask for.
      await this.enterHistory(revision);
    }
    return result;
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
