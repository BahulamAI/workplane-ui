import type { CommandGateway, CommitResult, WorkplaneDocument } from "../core/index.js";
import { workplaneError } from "../protocol/index.js";
import type { Actor, CommittedEvent, Transaction } from "../protocol/index.js";
import type { BahulamClient } from "./client.js";

interface CommitResponse {
  ok: boolean;
  revision?: number;
  document?: WorkplaneDocument;
  event?: CommittedEvent;
  replayed?: boolean;
  error?: {
    code: string;
    message: string;
    correlationId: string;
    retry: string;
    path?: string;
    detail?: Record<string, string | number | boolean>;
  };
}

/**
 * A `CommandGateway` over the host's HTTP command boundary — PRD section 12.2.
 *
 * The authority lives in the host process, so this is a genuine single writer
 * across tabs and clients, with real optimistic concurrency. The transport
 * changes; the commands do not. Both this and `LocalAuthority` must pass the
 * same conformance suite in `@bahulam/workplane-ui/testkit`, which is the whole
 * point of the interface existing.
 *
 * The actor is NOT sent in the body. The host derives it from the
 * authenticated session, so a payload claiming to be an administrator is not
 * authority. The `actor` argument here is used only for optimistic local
 * provenance where a caller wants it.
 */
export class HttpCommandGateway implements CommandGateway {
  readonly #client: BahulamClient;
  readonly #plugin: string;
  readonly #listeners = new Set<(event: CommittedEvent, document: WorkplaneDocument) => void>();
  #unsubscribe: (() => void) | undefined;
  /** Highest revision already delivered to listeners. */
  #lastSeenRevision = 0;
  #documentId: string | undefined;
  #resyncing: Promise<void> | undefined;

  constructor(client: BahulamClient) {
    this.#client = client;
    this.#plugin = client.plugin;
  }

  #base(): string {
    return `/api/workplane/${encodeURIComponent(this.#plugin)}`;
  }

  async snapshot(documentId: string): Promise<WorkplaneDocument | undefined> {
    try {
      const result = await this.#client.get<{ document?: WorkplaneDocument; documentId?: string }>(
        this.#base(),
      );
      // The host owns the document id for a plugin; a caller asking for a
      // different one is asking for something this boundary cannot serve.
      if (result?.documentId && result.documentId !== documentId) return undefined;
      // Remember where we are, so a later bus event replays only what is new
      // instead of every commit since the beginning.
      if (result?.document) {
        this.#documentId = result.document.id;
        this.#lastSeenRevision = Math.max(this.#lastSeenRevision, result.document.revision);
      }
      return result?.document;
    } catch {
      return undefined;
    }
  }

  async commit(transaction: Transaction, _actor: Actor): Promise<CommitResult> {
    let response: CommitResponse;
    try {
      response = await this.#client.post<CommitResponse>(`${this.#base()}/commands`, transaction);
    } catch (error) {
      // A transport failure is not a rejection: the command may or may not have
      // landed. Report uncertainty rather than inventing an outcome.
      return {
        ok: false,
        error: workplaneError("INTERNAL_ERROR", (error as Error).message, {
          correlationId: `transport_${transaction.commandId}`,
          retry: "retry-with-backoff",
        }),
      };
    }

    if (!response.ok || response.error) {
      const error = response.error;
      return {
        ok: false,
        error: workplaneError(
          (error?.code ?? "INTERNAL_ERROR") as Parameters<typeof workplaneError>[0],
          error?.message ?? "The command was rejected",
          {
            correlationId: error?.correlationId ?? `unknown_${transaction.commandId}`,
            ...(error?.path ? { path: error.path } : {}),
            ...(error?.detail ? { detail: error.detail } : {}),
            ...(error?.retry ? { retry: error.retry as never } : {}),
          },
        ),
      };
    }

    if (!response.document || !response.event || response.revision === undefined) {
      return {
        ok: false,
        error: workplaneError("INTERNAL_ERROR", "The host returned an incomplete commit receipt", {
          correlationId: `incomplete_${transaction.commandId}`,
        }),
      };
    }

    const result: CommitResult = {
      ok: true,
      revision: response.revision,
      document: response.document,
      event: response.event,
      replayed: response.replayed === true,
    };
    // Local echo, so a caller sees its own commit without waiting for SSE, and
    // record it as seen so the bus event that follows is not delivered twice.
    this.#documentId = result.document.id;
    this.#lastSeenRevision = Math.max(this.#lastSeenRevision, result.revision);
    for (const listener of this.#listeners) listener(result.event, result.document);
    return result;
  }

  async eventsAfter(documentId: string, revision: number): Promise<CommittedEvent[]> {
    try {
      const result = await this.#client.get<{ events?: CommittedEvent[] }>(
        `${this.#base()}/events?after=${revision}`,
      );
      return result?.events ?? [];
    } catch {
      return [];
    }
  }

  subscribe(listener: (event: CommittedEvent, document: WorkplaneDocument) => void): () => void {
    this.#listeners.add(listener);

    // Attach to the host bus once, on first subscriber.
    if (!this.#unsubscribe) {
      this.#unsubscribe = this.#client.subscribeEvents(
        (_name, data) => {
          const payload = data as { plugin?: string; target?: string } | undefined;
          if (payload?.plugin && payload.plugin !== this.#plugin) return;
          // The bus fires for every state write in the plugin, including
          // config. Only a Workplane write is worth a round trip; an unknown
          // target is resynced anyway rather than risk missing a commit.
          if (payload?.target && !payload.target.startsWith("workplane")) return;
          // The bus says "something changed", not what. Re-read the authorized
          // snapshot rather than trusting a broadcast payload as state.
          void this.#resync();
        },
        ["plugin_state_changed", "workplane_committed"],
      );
    }

    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#unsubscribe?.();
        this.#unsubscribe = undefined;
      }
    };
  }

  /**
   * Re-read the authorized snapshot and deliver whatever is new.
   *
   * Serialized: a burst of bus events must not start several overlapping
   * round trips that then deliver the same commits more than once.
   */
  async #resync(): Promise<void> {
    if (this.#resyncing) return this.#resyncing;
    this.#resyncing = (async () => {
      try {
        const documentId = this.#documentId;
        if (!documentId) return;
        const seen = this.#lastSeenRevision;
        const document = await this.snapshot(documentId);
        if (!document || document.revision <= seen) return;

        // Replay only what this client has not delivered yet. If the log has
        // been compacted past that point the events list is short and the
        // snapshot still carries the truth, which is why the document is
        // published regardless.
        const events = await this.eventsAfter(document.id, seen);
        this.#lastSeenRevision = document.revision;
        for (const event of events) {
          for (const listener of this.#listeners) listener(event, document);
        }
        if (events.length === 0) {
          // A gap we cannot enumerate. Publish the snapshot anyway rather than
          // leave the client silently behind.
          const synthetic: CommittedEvent = {
            documentId: document.id,
            revision: document.revision,
            commandId: "resync",
            operations: [],
            actor: { id: "host", type: "system" },
            committedAt: new Date().toISOString(),
          };
          for (const listener of this.#listeners) listener(synthetic, document);
        }
      } finally {
        this.#resyncing = undefined;
      }
    })();
    return this.#resyncing;
  }

  /** Optional: pre-set which document to watch before the first snapshot. */
  watch(documentId: string, fromRevision = 0): void {
    this.#documentId = documentId;
    this.#lastSeenRevision = Math.max(this.#lastSeenRevision, fromRevision);
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }
}
