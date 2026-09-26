import type { JsonValue } from "../protocol/index.js";

export type PresentationMode = "document" | "feed" | "stack";

/**
 * Which way Feed advances between scenes.
 *
 * A view preference, not a document property: the same scenes, blocks and
 * revisions are traversed either way, so changing it is not a migration. It
 * lives here rather than in `PresentationMode` because adding a fourth mode
 * would oblige every host to handle it, while an axis every Feed host already
 * handles by construction.
 */
export type FeedAxis = "horizontal" | "vertical";

export interface WorkplaneViewState {
  mode: PresentationMode;
  feedAxis: FeedAxis;
  navigationDomain: "scenes" | "history";
  activeSceneId: string | null;
  historyRevision: number | null;
  focusedBlockId: string | null;
  followNewScenes: boolean;
  reducedMotion: boolean;
}

export interface PresenterController {
  getViewState(): WorkplaneViewState;
  setMode(mode: PresentationMode): void;
  navigateToScene(sceneId: string): void;
  nextScene(): void;
  previousScene(): void;
  enterHistory(revision: number): Promise<void>;
  returnToLive(): void;
}

/**
 * An uncommitted local edit. Typing does not continuously overwrite shared
 * state: the draft records the value the user started from and the revision it
 * was read at, so a submit can tell "nothing else changed" from "someone else
 * changed this underneath me".
 */
export interface Draft {
  key: string;
  value: JsonValue;
  baselineValue: JsonValue;
  baselineRevision: number;
}

export type DraftResolution =
  | { status: "clean"; draft: Draft }
  | { status: "unchanged"; draft: Draft }
  | { status: "conflict"; draft: Draft; theirValue: JsonValue };

/**
 * Client-owned ephemeral state, deliberately held OUTSIDE React component
 * instances. Virtualizing a scene, switching presentation mode, or unmounting
 * a block must not destroy a half-typed form, so nothing here lives in a
 * component's lifetime.
 *
 * Nothing in this store is a business edit. It is never sent to an agent and
 * never included in a document revision.
 */
export class SessionStore {
  #drafts = new Map<string, Draft>();
  #selection = new Map<string, readonly string[]>();
  #playback = new Map<string, number>();
  #listeners = new Set<() => void>();
  #view: WorkplaneViewState;

  constructor(initialView?: Partial<WorkplaneViewState>) {
    this.#view = {
      mode: "document",
      feedAxis: "horizontal",
      navigationDomain: "scenes",
      activeSceneId: null,
      historyRevision: null,
      focusedBlockId: null,
      followNewScenes: false,
      reducedMotion: false,
      ...initialView,
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  // --- drafts ------------------------------------------------------------
  getDraft(key: string): Draft | undefined {
    return this.#drafts.get(key);
  }

  setDraft(key: string, value: JsonValue, baseline: { value: JsonValue; revision: number }): void {
    const existing = this.#drafts.get(key);
    this.#drafts.set(key, {
      key,
      value,
      // Keep the ORIGINAL baseline across keystrokes. Re-reading it on every
      // change would quietly absorb a concurrent edit and hide the conflict.
      baselineValue: existing?.baselineValue ?? baseline.value,
      baselineRevision: existing?.baselineRevision ?? baseline.revision,
    });
    this.#emit();
  }

  clearDraft(key: string): void {
    if (this.#drafts.delete(key)) this.#emit();
  }

  hasDrafts(): boolean {
    return this.#drafts.size > 0;
  }

  /**
   * Decide what a submit means, given the value currently committed.
   * `conflict` surfaces both versions to the user; it never silently wins.
   */
  resolveDraft(key: string, committedValue: JsonValue): DraftResolution | undefined {
    const draft = this.#drafts.get(key);
    if (!draft) return undefined;
    const sameAsCommitted = JSON.stringify(draft.value) === JSON.stringify(committedValue);
    const baselineHeld = JSON.stringify(draft.baselineValue) === JSON.stringify(committedValue);
    if (sameAsCommitted) return { status: "unchanged", draft };
    if (!baselineHeld) return { status: "conflict", draft, theirValue: committedValue };
    return { status: "clean", draft };
  }

  // --- transient per-block state ----------------------------------------
  getSelection(blockId: string): readonly string[] {
    return this.#selection.get(blockId) ?? [];
  }

  setSelection(blockId: string, ids: readonly string[]): void {
    this.#selection.set(blockId, ids);
    this.#emit();
  }

  /** Local playhead position. A movie resumes where this viewer left it. */
  getPlaybackPosition(blockId: string): number {
    return this.#playback.get(blockId) ?? 0;
  }

  setPlaybackPosition(blockId: string, seconds: number): void {
    this.#playback.set(blockId, seconds);
  }

  // --- view state --------------------------------------------------------
  getViewState(): WorkplaneViewState {
    return this.#view;
  }

  patchViewState(patch: Partial<WorkplaneViewState>): void {
    this.#view = { ...this.#view, ...patch };
    this.#emit();
  }
}
