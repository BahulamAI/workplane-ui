import { getPointer, type JsonObject, type JsonValue } from "@bahulam/workplane-protocol";
import type { WorkplaneDocument } from "./document.js";
import type { DocumentPolicy } from "./policy.js";

export interface AgentContext {
  documentId: string;
  title: string;
  revision: number;
  scenes: Array<{ id: string; title: string; blocks: Array<{ id: string; kind: string; title: string; summary: string }> }>;
  /** Committed filters and assumptions only — never a full dataset. */
  state: JsonObject;
  dataSources: Array<{ id: string; provider: string; resource: string; sourceVersion: string; sensitivity: string }>;
  writablePaths: Array<{ path: string; type: string }>;
  recentChanges: Array<{ revision: number; actor: string; summary: string }>;
  truncated: boolean;
}

export interface ProjectionOptions {
  policy: DocumentPolicy;
  /** Bounded recent history, newest last. */
  recentChanges?: AgentContext["recentChanges"];
  /** Design budget for Workplane-specific context. Not a model limit. */
  maxCharacters?: number;
}

/** ~4 characters per token is the rough industry heuristic; 8,000 tokens. */
const DEFAULT_MAX_CHARACTERS = 32_000;

function summarize(spec: JsonValue, kind: string): string {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return kind;
  }
  const record = spec as JsonObject;
  const interesting = ["measure", "dimension", "unit", "chartType", "field", "label"];
  const parts = interesting
    .filter((key) => typeof record[key] === "string" || typeof record[key] === "number")
    .map((key) => `${key}=${String(record[key])}`);
  return parts.length > 0 ? `${kind} (${parts.join(", ")})` : kind;
}

/**
 * What an agent is allowed to see. Excluded by construction: secrets, full
 * datasets, raw media, another user's private drafts and selections.
 *
 * Note what is NOT reachable from here — `document.artifacts` resolver
 * references, connection details, and query result pages all live outside this
 * projection, so a wider projection cannot leak them by accident.
 */
export function projectForAgent(
  document: WorkplaneDocument,
  options: ProjectionOptions,
): AgentContext {
  const budget = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;

  const state: JsonObject = {};
  for (const rule of options.policy.writablePaths) {
    if (rule.path.endsWith("/*")) {
      const prefix = rule.path.slice(0, -2);
      const parent = getPointer(document.shared, prefix);
      if (parent !== undefined) state[prefix] = parent;
      continue;
    }
    const value = getPointer(document.shared, rule.path);
    if (value !== undefined) state[rule.path] = value;
  }

  const context: AgentContext = {
    documentId: document.id,
    title: document.title,
    revision: document.revision,
    scenes: document.sceneOrder.map((sceneId) => {
      const scene = document.scenes[sceneId];
      return {
        id: sceneId,
        title: scene?.title ?? sceneId,
        blocks: (scene?.blockOrder ?? []).map((blockId) => {
          const block = document.blocks[blockId];
          return {
            id: blockId,
            kind: block?.kind ?? "unknown",
            title: block?.title ?? blockId,
            summary: block ? summarize(block.spec, block.kind) : "unavailable",
          };
        }),
      };
    }),
    state,
    dataSources: Object.values(document.dataSources).map((source) => ({
      id: source.id,
      provider: source.provider,
      resource: source.resource,
      sourceVersion: source.sourceVersion,
      sensitivity: source.sensitivity,
    })),
    writablePaths: options.policy.writablePaths.map((w) => ({ path: w.path, type: w.type })),
    recentChanges: options.recentChanges ?? [],
    truncated: false,
  };

  // Drop the oldest history, then the deepest scene detail, rather than
  // silently handing the model a truncated JSON fragment.
  if (JSON.stringify(context).length > budget) {
    context.recentChanges = context.recentChanges.slice(-3);
    context.truncated = true;
  }
  if (JSON.stringify(context).length > budget) {
    context.scenes = context.scenes.map((scene) => ({
      ...scene,
      blocks: scene.blocks.slice(0, 5),
    }));
  }
  return context;
}
