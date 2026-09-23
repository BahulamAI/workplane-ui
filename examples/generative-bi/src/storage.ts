import type { CommandReceipt, CommitBundle, StoragePort, WorkplaneDocument } from "@bahulam/workplane-core";
import type { CommittedEvent } from "@bahulam/workplane-protocol";

interface Persisted {
  document: WorkplaneDocument;
  events: CommittedEvent[];
  receipts: Record<string, CommandReceipt>;
}

/**
 * Browser-local authority storage.
 *
 * Embedded-local authority mode: ONE controller in ONE tab is the writer.
 * Multiple tabs are not automatically safe concurrent writers, so this adapter
 * does not pretend to coordinate them — a second tab would need a leader
 * election or read-only mode before it could be called safe.
 */
export class LocalStorageAdapter implements StoragePort {
  readonly #key: string;
  #cache: Persisted | undefined;

  constructor(key = "workplane.demo", seed?: WorkplaneDocument) {
    this.#key = key;
    const existing = this.#read();
    if (!existing && seed) {
      this.#write({ document: seed, events: [], receipts: {} });
    }
  }

  #read(): Persisted | undefined {
    if (this.#cache) return this.#cache;
    try {
      const raw = localStorage.getItem(this.#key);
      if (!raw) return undefined;
      this.#cache = JSON.parse(raw) as Persisted;
      return this.#cache;
    } catch {
      // A corrupt or unreadable store is not a reason to lose the session.
      return undefined;
    }
  }

  #write(next: Persisted): void {
    this.#cache = next;
    try {
      localStorage.setItem(this.#key, JSON.stringify(next));
    } catch (error) {
      console.warn("[workplane] could not persist document", error);
    }
  }

  async load(documentId: string): Promise<WorkplaneDocument | undefined> {
    const persisted = this.#read();
    return persisted?.document.id === documentId ? persisted.document : undefined;
  }

  async commit(bundle: CommitBundle): Promise<void> {
    const persisted = this.#read();
    // Document, event, and receipt are written as ONE value, so a crash cannot
    // leave an acknowledged change with no durable record.
    this.#write({
      document: bundle.document,
      events: [...(persisted?.events ?? []), bundle.event],
      receipts: { ...(persisted?.receipts ?? {}), [bundle.receipt.commandId]: bundle.receipt },
    });
  }

  async receipt(_documentId: string, commandId: string): Promise<CommandReceipt | undefined> {
    return this.#read()?.receipts[commandId];
  }

  async eventsAfter(_documentId: string, revision: number): Promise<CommittedEvent[]> {
    return (this.#read()?.events ?? []).filter((event) => event.revision > revision);
  }

  clear(): void {
    this.#cache = undefined;
    localStorage.removeItem(this.#key);
  }
}

/** View preferences persist separately — they are not business document edits. */
export const viewPreferences = {
  read(documentId: string): { mode?: string; activeSceneId?: string } {
    try {
      return JSON.parse(localStorage.getItem(`workplane.view.${documentId}`) ?? "{}");
    } catch {
      return {};
    }
  },
  write(documentId: string, value: { mode?: string; activeSceneId?: string }): void {
    try {
      localStorage.setItem(`workplane.view.${documentId}`, JSON.stringify(value));
    } catch {
      /* preferences are best-effort */
    }
  },
};
