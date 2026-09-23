import {
  fingerprint,
  workplaneError,
  type Actor,
  type CommittedEvent,
  type JsonValue,
  type Transaction,
  type WorkplaneError,
} from "@bahulam/workplane-protocol";
import { PROTOCOL_VERSION } from "@bahulam/workplane-protocol";
import type { WorkplaneDocument } from "./document.js";
import { DEFAULT_LIMITS, type WorkplaneLimits } from "./limits.js";
import { authorizeOperations, type DocumentPolicy } from "./policy.js";
import { applyOperations, ReducerError } from "./reducer.js";
import type { StoragePort } from "./storage.js";
import { validateDocument } from "./validate.js";

export type CommitResult =
  | { ok: true; revision: number; document: WorkplaneDocument; event: CommittedEvent; replayed: boolean }
  | { ok: false; error: WorkplaneError };

export interface CommandGateway {
  snapshot(documentId: string): Promise<WorkplaneDocument | undefined>;
  commit(transaction: Transaction, actor: Actor): Promise<CommitResult>;
  eventsAfter(documentId: string, revision: number): Promise<CommittedEvent[]>;
  subscribe(listener: (event: CommittedEvent, document: WorkplaneDocument) => void): () => void;
}

export interface LocalAuthorityOptions {
  storage: StoragePort;
  policy: DocumentPolicy;
  limits?: WorkplaneLimits;
  /** Injected so the authority stays pure enough to test deterministically. */
  now?: () => string;
  correlationId?: () => string;
}

let correlationCounter = 0;

/**
 * The single writer. Every durable change — from a user, an agent, or a
 * scripted host — passes through `commit`.
 *
 * Order matters and is deliberate: authenticate the actor, check the expected
 * revision, authorize each operation, apply to a COPY, validate the resulting
 * invariants, persist atomically, and only then broadcast. Nothing observes a
 * state that was never validated.
 */
export class LocalAuthority implements CommandGateway {
  readonly #storage: StoragePort;
  readonly #policy: DocumentPolicy;
  readonly #limits: WorkplaneLimits;
  readonly #now: () => string;
  readonly #correlationId: () => string;
  readonly #listeners = new Set<(event: CommittedEvent, document: WorkplaneDocument) => void>();
  /** Serializes commits so two in-flight transactions cannot both read revision N. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: LocalAuthorityOptions) {
    this.#storage = options.storage;
    this.#policy = options.policy;
    this.#limits = options.limits ?? DEFAULT_LIMITS;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#correlationId = options.correlationId ?? (() => `cor_${(++correlationCounter).toString(36)}`);
  }

  async snapshot(documentId: string): Promise<WorkplaneDocument | undefined> {
    return this.#storage.load(documentId);
  }

  async eventsAfter(documentId: string, revision: number): Promise<CommittedEvent[]> {
    return this.#storage.eventsAfter(documentId, revision);
  }

  subscribe(listener: (event: CommittedEvent, document: WorkplaneDocument) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  commit(transaction: Transaction, actor: Actor): Promise<CommitResult> {
    const run = this.#queue.then(
      () => this.#commitSerialized(transaction, actor),
      () => this.#commitSerialized(transaction, actor),
    );
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #commitSerialized(transaction: Transaction, actor: Actor): Promise<CommitResult> {
    const correlationId = this.#correlationId();
    const fail = (
      code: Parameters<typeof workplaneError>[0],
      message: string,
      extra?: { path?: string; detail?: Record<string, string | number | boolean> },
    ): CommitResult => ({
      ok: false,
      error: workplaneError(code, message, { correlationId, ...extra }),
    });

    if (transaction.protocolVersion !== PROTOCOL_VERSION) {
      return fail("UNSUPPORTED_VERSION", `Unsupported protocol version "${transaction.protocolVersion}"`, {
        path: "/protocolVersion",
      });
    }

    const document = await this.#storage.load(transaction.documentId);
    if (!document) {
      return fail("VALIDATION_FAILED", "Unknown document", { path: "/documentId" });
    }

    if (transaction.operations.length === 0) {
      return fail("VALIDATION_FAILED", "A transaction must contain at least one operation", {
        path: "/operations",
      });
    }
    if (transaction.operations.length > this.#limits.maxOperationsPerTransaction) {
      return fail(
        "RESOURCE_LIMIT",
        `Transaction has ${transaction.operations.length} operations, limit is ${this.#limits.maxOperationsPerTransaction}`,
        { path: "/operations" },
      );
    }

    // --- idempotency: same id + same payload replays, never reapplies ------
    const payloadFingerprint = fingerprint(transaction.operations as unknown as JsonValue);
    const prior = await this.#storage.receipt(transaction.documentId, transaction.commandId);
    if (prior) {
      if (prior.payloadFingerprint !== payloadFingerprint) {
        return fail(
          "IDEMPOTENCY_MISMATCH",
          "This command id was already used with a different payload",
          { path: "/commandId", detail: { revision: prior.revision } },
        );
      }
      const events = await this.#storage.eventsAfter(transaction.documentId, prior.revision - 1);
      const event = events.find((e) => e.revision === prior.revision);
      if (event) {
        return { ok: true, revision: prior.revision, document, event, replayed: true };
      }
    }

    // --- optimistic concurrency -------------------------------------------
    if (transaction.expectedRevision !== document.revision) {
      return fail(
        "CONFLICT",
        `Document is at revision ${document.revision}; the transaction expected ${transaction.expectedRevision}`,
        {
          path: "/expectedRevision",
          detail: { currentRevision: document.revision, expectedRevision: transaction.expectedRevision },
        },
      );
    }

    // --- authorization, before any state is computed ------------------------
    const denials = authorizeOperations(transaction.operations, actor, this.#policy);
    if (denials.length > 0) {
      const first = denials[0] as { path: string; message: string };
      return fail("FORBIDDEN", first.message, {
        path: first.path,
        detail: { denials: denials.length },
      });
    }

    // --- apply to a copy ----------------------------------------------------
    let candidate: WorkplaneDocument;
    try {
      candidate = applyOperations(document, transaction.operations);
    } catch (error) {
      if (error instanceof ReducerError) {
        return fail("VALIDATION_FAILED", error.message, { path: error.path });
      }
      return fail("INTERNAL_ERROR", "The transaction could not be applied", {});
    }

    // --- validate the RESULT, not just the operations -----------------------
    const revision = document.revision + 1;
    const next: WorkplaneDocument = { ...candidate, revision };
    const validation = validateDocument(next, this.#limits);
    if (!validation.ok) {
      const first = validation.violations[0] as { path: string; message: string };
      return fail("VALIDATION_FAILED", first.message, {
        path: first.path,
        detail: { violations: validation.violations.length },
      });
    }

    const event: CommittedEvent = {
      documentId: next.id,
      revision,
      commandId: transaction.commandId,
      operations: transaction.operations,
      actor: actor.label
        ? { id: actor.id, type: actor.type, label: actor.label }
        : { id: actor.id, type: actor.type },
      committedAt: this.#now(),
    };

    await this.#storage.commit({
      document: next,
      event,
      receipt: { commandId: transaction.commandId, payloadFingerprint, revision },
    });

    for (const listener of this.#listeners) listener(event, next);
    return { ok: true, revision, document: next, event, replayed: false };
  }
}
