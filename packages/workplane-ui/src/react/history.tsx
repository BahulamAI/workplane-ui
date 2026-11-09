import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry, HistoryListing, RevisionView } from "../core/index.js";
import { useWorkplaneContext } from "./context.js";
import { useControllerState, useViewState } from "./hooks.js";

/**
 * History navigation — PRD section 5.4.6.
 *
 * The rule that shapes this file: **scenes and revisions are different
 * sequences and must never be mixed into one unlabelled list.** A scene is a
 * chapter of the current document; a revision is the whole document at an
 * earlier moment. Presenting them together produces a control where "next"
 * sometimes means "later in the argument" and sometimes "later in time", and a
 * reader cannot tell which they are looking at.
 *
 * So the domain switch is explicit and labelled, and the preview says plainly
 * that it is read-only. The read-only part is not enforced here — the controller
 * refuses commits and actions while previewing, because hiding a button is not a
 * guarantee and a renderer's own form would still reach the gateway.
 */

export interface HistoryHandle {
  available: boolean;
  /** "scenes" or "history". Never ambiguous. */
  domain: "scenes" | "history";
  entries: readonly HistoryEntry[];
  /** False when the log is a bounded fallback rather than the full tables. */
  historyComplete: boolean;
  /** Why history cannot be shown, when it cannot. */
  unavailableReason?: string;
  loading: boolean;
  /** The revision being previewed, and how far behind live it is. */
  preview?: { revision: number; liveRevision: number };
  /** A refusal from the last attempt to open a revision. */
  failure?: string;
  open: (revision: number) => Promise<void>;
  returnToLive: () => void;
  /** What a restore would do. Undefined unless previewing. */
  describeRestore: () => string[] | undefined;
  restore: () => Promise<{ ok: boolean; message?: string }>;
}

export function useHistory(options?: { limit?: number }): HistoryHandle {
  const { controller } = useWorkplaneContext();
  const state = useControllerState();
  const view = useViewState();
  const [listing, setListing] = useState<HistoryListing | { unavailable: string } | undefined>();
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  const limit = options?.limit;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void controller.historyEntries(limit ? { limit } : undefined).then((result) => {
      if (!cancelled) {
        setListing(result);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
    // Re-read when live moves, so a newly committed revision appears in the log.
  }, [controller, limit, state.document?.revision]);

  const open = useCallback(
    async (revision: number) => {
      setFailure(undefined);
      const view: RevisionView = await controller.enterHistory(revision);
      // A refusal is shown, not swallowed. "History was compacted past this
      // point" is actionable; a blank panel is not.
      if (!view.ok) setFailure(view.message);
    },
    [controller],
  );

  const returnToLive = useCallback(() => {
    setFailure(undefined);
    controller.returnToLive();
  }, [controller]);

  const describeRestore = useCallback(
    () => controller.planRestore()?.description,
    [controller],
  );

  const restore = useCallback(async () => {
    const result = await controller.restorePreviewed();
    return result.ok ? { ok: true } : { ok: false, message: result.error.message };
  }, [controller]);

  const unavailable = listing && "unavailable" in listing ? listing.unavailable : undefined;

  return {
    available: controller.historyAvailable && !unavailable,
    domain: view.navigationDomain,
    entries: listing && "entries" in listing ? listing.entries : [],
    historyComplete: listing && "historyComplete" in listing ? listing.historyComplete : true,
    ...(unavailable ? { unavailableReason: unavailable } : {}),
    loading,
    ...(state.preview ? { preview: { revision: state.preview.revision, liveRevision: state.preview.liveRevision } } : {}),
    ...(failure ? { failure } : {}),
    open,
    returnToLive,
    describeRestore,
    restore,
  };
}

function describeActor(entry: HistoryEntry): string {
  const label = entry.actor.label ?? entry.actor.id;
  return entry.actor.type === "agent" ? `${label} (agent)` : label;
}

function describeOperations(entry: HistoryEntry): string {
  // Kinds, counted. The payloads are not shown: a log entry is "what happened",
  // and a reader who wants "what changed" opens the revision and sees the diff.
  const counts = new Map<string, number>();
  for (const kind of entry.operations) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, count]) => (count > 1 ? `${kind} ×${count}` : kind))
    .join(", ");
}

/**
 * The banner shown while a past revision is on screen.
 *
 * Deliberately prominent and always present. A historical document looks exactly
 * like a live one, and a reader who forgets which they are looking at will read
 * stale figures as current — that is the failure this exists to prevent.
 */
export function HistoryBanner(): React.ReactNode {
  const history = useHistory();
  const [confirming, setConfirming] = useState(false);
  const [restoreError, setRestoreError] = useState<string | undefined>();

  if (!history.preview) return null;
  const { revision, liveRevision } = history.preview;
  const description = confirming ? history.describeRestore() : undefined;

  return (
    <div data-workplane="history-banner" role="status">
      <p data-workplane="history-banner-text">
        <strong>Revision {revision}</strong> — a past state of this document, read-only.
        {liveRevision > revision ? ` The current revision is ${liveRevision}.` : ""}
      </p>
      <div data-workplane="history-banner-actions">
        <button type="button" onClick={history.returnToLive}>
          Return to current revision
        </button>
        {confirming ? null : (
          <button type="button" onClick={() => setConfirming(true)}>
            Restore this revision…
          </button>
        )}
      </div>

      {/* Section 5.4.6 makes correct restore semantics mandatory before the
          control is offered, so what will happen is stated before confirming —
          including what a restore cannot undo. */}
      {confirming ? (
        <div data-workplane="history-restore-confirm">
          <ul>
            {(description ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {restoreError ? (
            <p data-workplane="history-restore-error" role="alert">{restoreError}</p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setRestoreError(undefined);
              void history.restore().then((result) => {
                if (result.ok) setConfirming(false);
                else setRestoreError(result.message);
              });
            }}
          >
            Restore as a new revision
          </button>
          <button type="button" onClick={() => { setConfirming(false); setRestoreError(undefined); }}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The revision list, and the labelled switch between the two sequences.
 *
 * `onDomainChange` is how a host puts the scene navigator and this list in the
 * same place without merging them. Passing nothing renders the list alone.
 */
export function HistoryPanel({
  onDomainChange,
}: {
  onDomainChange?: (domain: "scenes" | "history") => void;
} = {}): React.ReactNode {
  const history = useHistory();
  const { document } = useControllerState();

  if (history.unavailableReason) {
    return (
      <div data-workplane="history-unavailable" role="status">
        <p>{history.unavailableReason}</p>
      </div>
    );
  }

  return (
    <div data-workplane="history" data-domain={history.domain}>
      {onDomainChange ? (
        // A real tablist: these DO switch between two panels, which is exactly
        // when the tab keyboard contract is the honest one to use.
        <div data-workplane="history-domain" role="tablist" aria-label="Navigate by">
          <button
            type="button" role="tab"
            aria-selected={history.domain === "scenes"}
            onClick={() => { history.returnToLive(); onDomainChange("scenes"); }}
          >
            Scenes
          </button>
          <button
            type="button" role="tab"
            aria-selected={history.domain === "history"}
            onClick={() => onDomainChange("history")}
          >
            History
          </button>
        </div>
      ) : null}

      {history.failure ? (
        <p data-workplane="history-failure" role="alert">{history.failure}</p>
      ) : null}

      {history.loading && history.entries.length === 0 ? (
        <p data-workplane="history-loading">Reading history…</p>
      ) : null}

      <ol data-workplane="history-entries">
        {history.entries.map((entry) => {
          const current = document?.revision === entry.revision && !history.preview;
          const previewing = history.preview?.revision === entry.revision;
          return (
            <li key={entry.revision} data-revision={entry.revision} data-current={current || undefined}>
              <button
                type="button"
                aria-current={previewing ? "true" : undefined}
                onClick={() => (current ? history.returnToLive() : void history.open(entry.revision))}
              >
                <span data-workplane="history-revision">
                  {entry.revision}
                  {current ? " (current)" : ""}
                </span>
                <span data-workplane="history-actor">{describeActor(entry)}</span>
                <time dateTime={entry.committedAt}>{entry.committedAt}</time>
                <span data-workplane="history-operations">{describeOperations(entry)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {history.historyComplete ? null : (
        // Saying "as far back as we can see" rather than implying this is
        // everything. The bounded fallback exists on Node below 22.
        <p data-workplane="history-truncated" role="status">
          This is as far back as this host can see. Earlier revisions were not retained.
        </p>
      )}
    </div>
  );
}
