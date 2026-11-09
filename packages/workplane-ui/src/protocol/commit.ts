import { canonicalize } from "./json.js";
import type { CommittedEvent, Operation } from "./transaction.js";

/**
 * Content-addressed commit identity.
 *
 * A revision number says "the twelfth change". A commit id says "this exact
 * change, on top of that exact history, by that actor". Only the second lets
 * two replicas notice they disagree — which is the whole point of adding it.
 *
 * Hashed over parent + document + revision + canonical operations + actor +
 * timestamp, the same inputs git commits over. Canonical serialization means
 * key order cannot change the id.
 */
export const COMMIT_ID_PREFIX = "wpc_";

export interface CommitInput {
  parentId: string | null;
  documentId: string;
  revision: number;
  operations: readonly Operation[];
  actorId: string;
  committedAt: string;
}

function encode(input: CommitInput): string {
  // A field-tagged, length-free encoding: no two different inputs can produce
  // the same string by shifting a delimiter.
  return [
    `parent:${input.parentId ?? ""}`,
    `document:${input.documentId}`,
    `revision:${input.revision}`,
    `actor:${input.actorId}`,
    `at:${input.committedAt}`,
    `ops:${canonicalize(input.operations as never)}`,
  ].join("\n");
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 via WebCrypto, which is a standard global in browsers and Node 18+.
 * Deliberately not `node:crypto`: the headless core must stay free of Node
 * builtins so it can run in a browser, a worker, or a server unchanged.
 */
export async function computeCommitId(input: CommitInput): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "WebCrypto is unavailable, so commit ids cannot be computed. " +
        "Workplane requires a runtime with globalThis.crypto.subtle (browsers, Node 18+).",
    );
  }
  const bytes = new TextEncoder().encode(encode(input));
  return COMMIT_ID_PREFIX + toHex(await subtle.digest("SHA-256", bytes));
}

/** Short form for logs and UI. Full ids remain the identity. */
export function shortCommitId(commitId: string): string {
  return commitId.startsWith(COMMIT_ID_PREFIX)
    ? commitId.slice(COMMIT_ID_PREFIX.length, COMMIT_ID_PREFIX.length + 12)
    : commitId.slice(0, 12);
}

export type HistoryVerdict =
  | { status: "empty" }
  /** Every link checks out. `head` is the latest commit id. */
  | { status: "verified"; head: string; length: number }
  /**
   * Some events predate content addressing, or a range was compacted away.
   * Not a fault — just not provable. Reported distinctly from divergence
   * because "I cannot check" and "this is wrong" are different answers.
   */
  | { status: "unverifiable"; reason: string; atRevision: number }
  /** A link does not match: this history is not the one it claims to extend. */
  | { status: "broken"; atRevision: number; expectedParent: string | null; actualParent: string | null };

/**
 * Walk a contiguous run of events and check that each one names its
 * predecessor. Verifies the CHAIN, not the ids themselves — recomputing a
 * commit id needs the operations, which a bounded projection may not carry.
 */
export function verifyHistory(events: readonly CommittedEvent[]): HistoryVerdict {
  if (events.length === 0) return { status: "empty" };

  let previous: CommittedEvent | undefined;
  for (const event of events) {
    if (!event.commitId) {
      return {
        status: "unverifiable",
        reason: "event predates content-addressed commits",
        atRevision: event.revision,
      };
    }
    if (previous) {
      if (event.revision !== previous.revision + 1) {
        return {
          status: "unverifiable",
          reason: `gap between revisions ${previous.revision} and ${event.revision}`,
          atRevision: event.revision,
        };
      }
      if (event.parentId !== previous.commitId) {
        return {
          status: "broken",
          atRevision: event.revision,
          expectedParent: previous.commitId ?? null,
          actualParent: event.parentId ?? null,
        };
      }
    }
    previous = event;
  }
  return { status: "verified", head: previous!.commitId!, length: events.length };
}

export interface DivergenceReport {
  /** Last commit both histories agree on, or null if they never agreed. */
  commonAncestorId: string | null;
  commonAncestorRevision: number | null;
  /** Commits only the local side has, oldest first. */
  localOnly: CommittedEvent[];
  /** Commits only the remote side has, oldest first. */
  remoteOnly: CommittedEvent[];
  diverged: boolean;
}

/**
 * Find where two histories part company — git's merge-base, for the case that
 * actually bites here: a panel and a host authority that each believe they hold
 * the current document.
 *
 * Comparing revision numbers alone cannot detect this. Two writers both produce
 * "revision 11", and the numbers agree while the content does not. Commit ids
 * make the disagreement visible.
 */
export function compareHistories(
  local: readonly CommittedEvent[],
  remote: readonly CommittedEvent[],
): DivergenceReport {
  let commonAncestorId: string | null = null;
  let commonAncestorRevision: number | null = null;
  let index = 0;

  while (index < local.length && index < remote.length) {
    const a = local[index]!;
    const b = remote[index]!;
    if (!a.commitId || !b.commitId || a.commitId !== b.commitId) break;
    commonAncestorId = a.commitId;
    commonAncestorRevision = a.revision;
    index += 1;
  }

  const localOnly = local.slice(index);
  const remoteOnly = remote.slice(index);
  return {
    commonAncestorId,
    commonAncestorRevision,
    localOnly,
    remoteOnly,
    diverged: localOnly.length > 0 && remoteOnly.length > 0,
  };
}
