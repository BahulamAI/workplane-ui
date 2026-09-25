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
    // Local echo, so a caller sees its own commit without waiting for SSE.
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
          const payload = data as { plugin?: string; key?: string } | undefined;
          if (payload?.plugin && payload.plugin !== this.#plugin) return;
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

  #lastSeenRevision = 0;

  async #resync(): Promise<void> {
    const document = await this.snapshot(this.#documentIdHint ?? "");
    if (!document || document.revision <= this.#lastSeenRevision) return;
    const events = await this.eventsAfter(document.id, this.#lastSeenRevision);
    this.#lastSeenRevision = document.revision;
    for (const event of events) {
      for (const listener of this.#listeners) listener(event, document);
    }
  }

  #documentIdHint: string | undefined;

  /** Tells the gateway which document to re-read when the bus fires. */
  watch(documentId: string, fromRevision = 0): void {
    this.#documentIdHint = documentId;
    this.#lastSeenRevision = fromRevision;
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }
}
