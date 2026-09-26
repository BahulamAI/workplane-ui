import type { ComponentType } from "react";
import type { Block, WorkplaneController } from "../core/index.js";
import type { QueryResult } from "../data/index.js";
import type { JsonValue } from "../protocol/index.js";
import type { BlockActivity, RendererContract, RendererDescriptor } from "../renderers/index.js";
import { toDescriptor } from "../renderers/index.js";

export type { BlockActivity, RendererCapabilities, ValidationOutcome } from "../renderers/index.js";

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
  /**
   * Whether this block should be actively rendering. A renderer that declares
   * `suspend: true` must release expensive resources when this is not
   * "active"; one that declares `suspend: false` may ignore it.
   */
  activity: BlockActivity;
  /** Safe failure message per declared dataRef, when that query failed. */
  errors: ReadonlyMap<string, string>;
  emit: (event: RendererEvent) => void;
}

/**
 * A renderer is its contract plus a component.
 *
 * Extending rather than restating the contract is what makes advertising
 * mandatory: there is no way to register something drawable without also
 * declaring its purpose and a working example, so the catalog cannot fall
 * behind the validators.
 */
export interface RendererDefinition<TSpec = JsonValue> extends RendererContract<TSpec> {
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

  /**
   * Catalog discovery for an agent, derived from what is actually registered.
   * A renderer the host did not register does not appear, and one that is
   * registered cannot be missing its purpose or example.
   */
  list(): RendererDescriptor[] {
    return [...this.#definitions.values()].map(toDescriptor);
  }

  contracts(): RendererContract<never>[] {
    return [...this.#definitions.values()];
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
