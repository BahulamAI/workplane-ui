import { fingerprint, type JsonObject } from "@bahulam/workplane-protocol";
import type { DataProvider, QueryResult } from "./query.js";

export interface EpochState {
  /** Increments once per coherent publication. */
  epoch: number;
  results: ReadonlyMap<string, QueryResult>;
  pending: ReadonlySet<string>;
  /** True while a newer epoch is loading and older results are still shown. */
  stale: boolean;
}

export interface CoordinatorOptions {
  provider: DataProvider;
  /** Trailing debounce for expensive reads. Local field feedback is immediate. */
  debounceMs?: number;
  onPublish: (state: EpochState) => void;
}

interface QueryPlan {
  queryId: string;
  spec: unknown;
  parameters: JsonObject;
}

/**
 * Runs queries and publishes results in coherent groups.
 *
 * Two rules do the real work here:
 *
 *  1. Every execution carries a generation. A result whose generation is
 *     behind the query's current generation is DISCARDED — even if it arrives
 *     last, even if cancellation failed. A result for a previous date range
 *     must never overwrite the current chart.
 *
 *  2. A group is published only when every query in it has landed. The
 *     previous coherent group stays visible, marked stale, rather than showing
 *     a new metric beside an old comparison.
 */
export class QueryCoordinator {
  readonly #provider: DataProvider;
  readonly #debounceMs: number;
  readonly #onPublish: (state: EpochState) => void;

  #generation = new Map<string, number>();
  #results = new Map<string, QueryResult>();
  #pending = new Set<string>();
  #controllers = new Map<string, AbortController>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #queued: QueryPlan[] = [];
  #epoch = 0;
  /** Results held back until the whole group is ready. */
  #staging = new Map<string, QueryResult>();
  #groupSize = 0;

  constructor(options: CoordinatorOptions) {
    this.#provider = options.provider;
    this.#debounceMs = options.debounceMs ?? 250;
    this.#onPublish = options.onPublish;
  }

  getState(): EpochState {
    return {
      epoch: this.#epoch,
      results: new Map(this.#results),
      pending: new Set(this.#pending),
      stale: this.#pending.size > 0,
    };
  }

  /** Coalesce rapid changes; only the last plan in a burst executes. */
  request(plans: readonly QueryPlan[]): void {
    this.#queued = [...plans];
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run(this.#queued);
    }, this.#debounceMs);
  }

  /** Execute immediately, bypassing the debounce. Used on first load. */
  async runNow(plans: readonly QueryPlan[]): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#run(plans);
  }

  async #run(plans: readonly QueryPlan[]): Promise<void> {
    if (plans.length === 0) return;

    this.#staging.clear();
    this.#groupSize = plans.length;
    for (const plan of plans) this.#pending.add(plan.queryId);
    this.#onPublish(this.getState());

    await Promise.all(plans.map((plan) => this.#execute(plan)));
  }

  async #execute(plan: QueryPlan): Promise<void> {
    const generation = (this.#generation.get(plan.queryId) ?? 0) + 1;
    this.#generation.set(plan.queryId, generation);

    // Abort the previous attempt. We still guard on generation below, because
    // a provider is free to ignore the signal and resolve anyway.
    this.#controllers.get(plan.queryId)?.abort();
    const controller = new AbortController();
    this.#controllers.set(plan.queryId, controller);

    try {
      const result = await this.#provider.execute({
        queryId: plan.queryId,
        spec: plan.spec as never,
        parameters: plan.parameters,
        generation,
        signal: controller.signal,
      });

      if (this.#generation.get(plan.queryId) !== generation) return; // late, discard
      this.#staging.set(plan.queryId, { ...result, generation });
    } catch {
      if (this.#generation.get(plan.queryId) !== generation) return;
      // A failed query leaves the prior coherent result in place, marked stale.
    } finally {
      if (this.#generation.get(plan.queryId) === generation) {
        this.#pending.delete(plan.queryId);
        this.#maybePublish();
      }
    }
  }

  #maybePublish(): void {
    if (this.#pending.size > 0) return;
    if (this.#staging.size === 0 && this.#groupSize > 0) {
      this.#onPublish(this.getState());
      return;
    }
    for (const [queryId, result] of this.#staging) this.#results.set(queryId, result);
    this.#staging.clear();
    this.#epoch += 1;
    this.#onPublish(this.getState());
  }

  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
  }
}

/** Stable fingerprint of resolved parameters, for cache keys and staleness. */
export function parameterFingerprint(parameters: JsonObject, partition: string): string {
  return fingerprint({ parameters, partition });
}
