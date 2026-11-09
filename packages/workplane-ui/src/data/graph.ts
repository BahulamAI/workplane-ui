export class DependencyCycleError extends Error {
  readonly cycle: readonly string[];
  constructor(cycle: readonly string[]) {
    super(`Dependency cycle: ${cycle.join(" -> ")}`);
    this.name = "DependencyCycleError";
    this.cycle = cycle;
  }
}

export interface QueryRegistration {
  queryId: string;
  /** Shared-state JSON Pointers this query's parameters read. */
  dependsOnPaths: readonly string[];
  /** Other queries whose results this one consumes. */
  dependsOnQueries?: readonly string[];
}

export interface BlockRegistration {
  blockId: string;
  dependsOnPaths: readonly string[];
  dependsOnQueries: readonly string[];
}

/**
 * Which queries and blocks must be re-evaluated when a shared path changes.
 *
 * Cycles are rejected at REGISTRATION, not discovered at evaluation time —
 * a cycle found mid-update is an infinite loop in front of a user.
 */
export class DependencyGraph {
  #queries = new Map<string, QueryRegistration>();
  #blocks = new Map<string, BlockRegistration>();

  registerQuery(registration: QueryRegistration): void {
    this.#queries.set(registration.queryId, registration);
    const cycle = this.#findCycle(registration.queryId);
    if (cycle) {
      this.#queries.delete(registration.queryId);
      throw new DependencyCycleError(cycle);
    }
  }

  registerBlock(registration: BlockRegistration): void {
    this.#blocks.set(registration.blockId, registration);
  }

  unregisterQuery(queryId: string): void {
    this.#queries.delete(queryId);
  }

  unregisterBlock(blockId: string): void {
    this.#blocks.delete(blockId);
  }

  #findCycle(startId: string): string[] | undefined {
    const path: string[] = [];
    const visiting = new Set<string>();

    const walk = (id: string): string[] | undefined => {
      if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];
      const registration = this.#queries.get(id);
      if (!registration) return undefined;
      visiting.add(id);
      path.push(id);
      for (const next of registration.dependsOnQueries ?? []) {
        const found = walk(next);
        if (found) return found;
      }
      path.pop();
      visiting.delete(id);
      return undefined;
    };

    return walk(startId);
  }

  /** Does `path` fall under, or contain, the registered dependency `dep`? */
  static #touches(dep: string, changed: string): boolean {
    return dep === changed || changed.startsWith(`${dep}/`) || dep.startsWith(`${changed}/`);
  }

  /** Queries invalidated by a change at `changedPath`, transitively. */
  queriesAffectedBy(changedPath: string): string[] {
    const direct = new Set<string>();
    for (const [queryId, registration] of this.#queries) {
      if (registration.dependsOnPaths.some((dep) => DependencyGraph.#touches(dep, changedPath))) {
        direct.add(queryId);
      }
    }
    // Fan out to queries that consume an invalidated query.
    let grew = true;
    while (grew) {
      grew = false;
      for (const [queryId, registration] of this.#queries) {
        if (direct.has(queryId)) continue;
        if ((registration.dependsOnQueries ?? []).some((dep) => direct.has(dep))) {
          direct.add(queryId);
          grew = true;
        }
      }
    }
    return [...direct];
  }

  /** Blocks that must repaint, given a change and the queries it invalidated. */
  blocksAffectedBy(changedPath: string): string[] {
    const queries = new Set(this.queriesAffectedBy(changedPath));
    const blocks: string[] = [];
    for (const [blockId, registration] of this.#blocks) {
      const byPath = registration.dependsOnPaths.some((dep) =>
        DependencyGraph.#touches(dep, changedPath),
      );
      const byQuery = registration.dependsOnQueries.some((q) => queries.has(q));
      if (byPath || byQuery) blocks.push(blockId);
    }
    return blocks;
  }

  /**
   * Blocks that must update together to stay coherent — the KPI, the chart,
   * and the table that all read one filter. They are published as one epoch.
   */
  coherenceGroupFor(changedPath: string): { blocks: string[]; queries: string[] } {
    return {
      blocks: this.blocksAffectedBy(changedPath),
      queries: this.queriesAffectedBy(changedPath),
    };
  }
}
