/**
 * Default resource limits. The host may configure them; it may not remove
 * them. An absent limit is how a hostile import turns into a denial of
 * service, so every field here is required.
 */
export interface WorkplaneLimits {
  maxScenes: number;
  maxBlocks: number;
  maxBlocksPerScene: number;
  /** Nesting depth of a block `spec`, counting objects and arrays. */
  maxSpecDepth: number;
  /** Canonical byte length of a single block `spec`. */
  maxSpecBytes: number;
  /** Canonical byte length of the whole `shared` object. */
  maxSharedBytes: number;
  maxOperationsPerTransaction: number;
  /** Bytes accepted from an imported `.workplane.json`. */
  maxImportBytes: number;
  maxTitleLength: number;
  maxIdLength: number;
}

export const DEFAULT_LIMITS: WorkplaneLimits = {
  maxScenes: 100,
  maxBlocks: 500,
  maxBlocksPerScene: 100,
  maxSpecDepth: 16,
  maxSpecBytes: 64 * 1024,
  maxSharedBytes: 256 * 1024,
  maxOperationsPerTransaction: 64,
  maxImportBytes: 8 * 1024 * 1024,
  maxTitleLength: 200,
  maxIdLength: 128,
};

export function withLimits(overrides: Partial<WorkplaneLimits>): WorkplaneLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}
