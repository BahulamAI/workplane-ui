import type {
  CommandReceipt,
  CommitBundle,
  StoragePort,
  WorkplaneDocument,
} from "@bahulam/workplane-core";
import type { CommittedEvent, JsonValue } from "@bahulam/workplane-protocol";
import type { BahulamClient } from "./client.js";

/** Default KV key. Deliberately NOT `workplane`, which the legacy widget
 *  panel owns — a Workplane view must not disturb it. */
export const DEFAULT_DOCUMENT_KEY = "workplane_document";

interface Persisted {
  document: WorkplaneDocument;
  events: CommittedEvent[];
  receipts: Record<string, CommandReceipt>;
}

export interface PluginStateStorageOptions {
  client: BahulamClient;
  /** Seeds the key on first use. */
  seed: WorkplaneDocument;
  key?: string;
  /** Bounded audit log; older events are compacted away. PRD 19.1. */
  maxEvents?: number;
}

/**
 * A `StoragePort` over the Bahulam shared blackboard.
 *
 * The whole persisted bundle — document, event log, and idempotency receipts —
 * lives under ONE key and is written in ONE `set`. That is what makes the
 * commit atomic at this layer: a crash cannot leave an acknowledged change
 * with no durable record, because there is no second write to lose.
 *
 * Honest limitation: the blackboard has no compare-and-set, so this is
 * last-writer-wins between processes. It is safe because exactly one
 * `LocalAuthority` in one tab is the writer — the embedded-local authority mode
 * in PRD section 6.3, which states plainly that multiple tabs are not
 * automatically safe concurrent writers. For a genuine single writer across
 * clients, use `HttpCommandGateway` against the host command boundary instead.
 */
export class PluginStateStorage implements StoragePort {
  readonly #client: BahulamClient;
  readonly #key: string;
  readonly #seed: WorkplaneDocument;
  readonly #maxEvents: number;
  #cache: Persisted | undefined;

  constructor(options: PluginStateStorageOptions) {
    this.#client = options.client;
    this.#key = options.key ?? DEFAULT_DOCUMENT_KEY;
    this.#seed = options.seed;
    this.#maxEvents = options.maxEvents ?? 500;
  }

  async #read(): Promise<Persisted> {
    if (this.#cache) return this.#cache;
    const raw = await this.#client.getKey<Persisted>(this.#key);
    if (raw && typeof raw === "object" && raw.document?.id) {
      this.#cache = {
        document: raw.document,
        events: Array.isArray(raw.events) ? raw.events : [],
        receipts: raw.receipts && typeof raw.receipts === "object" ? raw.receipts : {},
      };
    } else {
      this.#cache = { document: this.#seed, events: [], receipts: {} };
      await this.#write(this.#cache);
    }
    return this.#cache;
  }

  async #write(next: Persisted): Promise<void> {
    this.#cache = next;
    await this.#client.setKey(this.#key, next as unknown as JsonValue);
  }

  async load(documentId: string): Promise<WorkplaneDocument | undefined> {
    const persisted = await this.#read();
    return persisted.document.id === documentId ? persisted.document : undefined;
  }

  async commit(bundle: CommitBundle): Promise<void> {
    const persisted = await this.#read();
    const events = [...persisted.events, bundle.event];
    await this.#write({
      document: bundle.document,
      // Compact the oldest events rather than growing without bound. A
      // truncated log means a reconnecting client gets a fresh snapshot,
      // which the protocol already handles.
      events: events.length > this.#maxEvents ? events.slice(-this.#maxEvents) : events,
      receipts: { ...persisted.receipts, [bundle.receipt.commandId]: bundle.receipt },
    });
  }

  async receipt(_documentId: string, commandId: string): Promise<CommandReceipt | undefined> {
    return (await this.#read()).receipts[commandId];
  }

  async eventsAfter(_documentId: string, revision: number): Promise<CommittedEvent[]> {
    return (await this.#read()).events.filter((event) => event.revision > revision);
  }

  /** Drop the in-process cache so the next read re-fetches from the host. */
  invalidate(): void {
    this.#cache = undefined;
  }

  /** Remove the document entirely. Used by tests and a demo reset. */
  async clear(): Promise<void> {
    this.#cache = undefined;
    await this.#client.state("delete", { key: this.#key });
  }
}
