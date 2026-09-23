import type { ComponentType } from "react";
import type { Block, WorkplaneController } from "@bahulam/workplane-core";
import type { QueryResult } from "@bahulam/workplane-data";
import type { JsonValue } from "@bahulam/workplane-protocol";

export interface RendererCapabilities {
  interactive: boolean;
  selection: boolean;
  thumbnail: boolean;
  staticExport: boolean;
  suspend: boolean;
  requiresWebGL: boolean;
}

export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; path?: string };

/**
 * A normalized user event. An ECharts bar click and a 3D object pick both
 * arrive here as the same business selection, so a block never leaks its
 * engine's callback shape into the document.
 */
export type RendererEvent =
  | {
      type: "selection.changed";
      interactionId: string;
      payload: { entityType: string; ids: string[]; mode: "replace" | "add" | "toggle" };
    }
  | { type: "value.draft"; payload: { path: string; value: JsonValue } }
  | { type: "value.commit"; payload: { path: string; value: JsonValue } }
  | { type: "action.request"; payload: { actionId: string; arguments: Record<string, JsonValue> } };

/**
 * What a renderer is handed. Note what is NOT here: the host application, a
 * database connection, the agent runtime, the command gateway, or the
 * document. A renderer displays a bounded projection and emits events; it
 * cannot commit, and it cannot read another block's state.
 */
export interface RendererProps<TSpec = JsonValue> {
  block: Block;
  spec: TSpec;
  /** Only the results this block declared in `dataRefs`. */
  results: ReadonlyMap<string, QueryResult>;
  /** Resolved values for this block's declared bindings. */
  bindings: Readonly<Record<string, JsonValue | undefined>>;
  /** True while a newer evaluation epoch is loading. */
  stale: boolean;
  emit: (event: RendererEvent) => void;
}

export interface RendererDefinition<TSpec = JsonValue> {
  id: string;
  specVersions: readonly string[];
  /**
   * Assigned by the HOST registry. A community manifest declaring itself
   * "host-reviewed" does not become trusted by saying so.
   */
  trust: "host-reviewed" | "sandboxed";
  capabilities: RendererCapabilities;
  validate(spec: unknown): ValidationOutcome<TSpec>;
  /** Bounded plain text for agent context. Never the full spec. */
  summarize(spec: TSpec): string;
  Component: ComponentType<RendererProps<TSpec>>;
}

export class RendererRegistry {
  #definitions = new Map<string, RendererDefinition<never>>();

  register<TSpec>(definition: RendererDefinition<TSpec>): this {
    this.#definitions.set(definition.id, definition as unknown as RendererDefinition<never>);
    return this;
  }

  get(rendererId: string): RendererDefinition<never> | undefined {
    return this.#definitions.get(rendererId);
  }

  has(rendererId: string): boolean {
    return this.#definitions.has(rendererId);
  }

  /** Catalog discovery for an agent: ids, versions, capabilities. */
  list(): Array<Pick<RendererDefinition, "id" | "specVersions" | "trust" | "capabilities">> {
    return [...this.#definitions.values()].map(({ id, specVersions, trust, capabilities }) => ({
      id,
      specVersions,
      trust,
      capabilities,
    }));
  }
}

export interface PresenterProps {
  controller: WorkplaneController;
}

export interface PresenterDefinition {
  mode: string;
  /** Why this presenter is unavailable here, when it is. */
  unsupportedReason?: string;
  Component: ComponentType<PresenterProps>;
}
