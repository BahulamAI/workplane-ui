import type { CommittedEvent } from "../protocol/index.js";
import type { WorkplaneDocument } from "./document.js";

export interface CommandReceipt {
  commandId: string;
  /** Fingerprint of the canonical operations, for idempotency comparison. */
  payloadFingerprint: string;
  revision: number;
}

/**
 * What the authority persists in ONE atomic unit: the document snapshot, the
 * committed event, and the idempotency receipt. A crash must not leave an
 * acknowledged change with no durable record, which is why these three are
 * written together rather than as three calls.
 */
export interface CommitBundle {
  document: WorkplaneDocument;
  event: CommittedEvent;
  receipt: CommandReceipt;
}

export interface StoragePort {
  load(documentId: string): Promise<WorkplaneDocument | undefined>;
  /** Must be atomic across all three members of the bundle. */
  commit(bundle: CommitBundle): Promise<void>;
  receipt(documentId: string, commandId: string): Promise<CommandReceipt | undefined>;
  /** Committed events after `revision`, for reconnect and replay. */
  eventsAfter(documentId: string, revision: number): Promise<CommittedEvent[]>;
}

/** Reference in-memory adapter. Atomic because nothing here can interleave. */
export class MemoryStorage implements StoragePort {
  #documents = new Map<string, WorkplaneDocument>();
  #events = new Map<string, CommittedEvent[]>();
  #receipts = new Map<string, CommandReceipt>();

  constructor(seed?: WorkplaneDocument) {
    if (seed) this.#documents.set(seed.id, seed);
  }

  async load(documentId: string): Promise<WorkplaneDocument | undefined> {
    return this.#documents.get(documentId);
  }

  async commit(bundle: CommitBundle): Promise<void> {
    const { document, event, receipt } = bundle;
    this.#documents.set(document.id, document);
    this.#events.set(document.id, [...(this.#events.get(document.id) ?? []), event]);
    this.#receipts.set(`${document.id}::${receipt.commandId}`, receipt);
  }

  async receipt(documentId: string, commandId: string): Promise<CommandReceipt | undefined> {
    return this.#receipts.get(`${documentId}::${commandId}`);
  }

  async eventsAfter(documentId: string, revision: number): Promise<CommittedEvent[]> {
    return (this.#events.get(documentId) ?? []).filter((e) => e.revision > revision);
  }
}
