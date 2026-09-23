import type { PresentationMode } from "@bahulam/workplane-core";
import { useViewState } from "../hooks.js";
import type { PresenterDefinition, PresenterProps } from "../registry.js";
import { documentPresenter } from "./document.js";

export { documentPresenter };

export class PresenterRegistry {
  #presenters = new Map<string, PresenterDefinition>();

  register(definition: PresenterDefinition): this {
    this.#presenters.set(definition.mode, definition);
    return this;
  }

  get(mode: string): PresenterDefinition | undefined {
    return this.#presenters.get(mode);
  }

  supported(): string[] {
    return [...this.#presenters.keys()];
  }
}

/**
 * Feed and Stack are specified in the PRD (section 5.4) and scheduled for M2
 * and M3. They are registered here as explicitly unsupported rather than
 * omitted, so a host that requests one gets a stated reason and a working
 * fallback instead of a blank region.
 */
const NOT_YET_IMPLEMENTED: Record<string, string> = {
  feed: "Feed presentation is specified for milestone M2 and is not implemented yet.",
  stack: "Stack presentation is specified for milestone M3 and is not implemented yet.",
};

export function createPresenterRegistry(): PresenterRegistry {
  const registry = new PresenterRegistry().register(documentPresenter);
  for (const [mode, reason] of Object.entries(NOT_YET_IMPLEMENTED)) {
    registry.register({
      mode,
      unsupportedReason: reason,
      Component: documentPresenter.Component,
    });
  }
  return registry;
}

/**
 * Resolve the requested mode against what is actually installed. An
 * unsupported mode falls back to Document WITH a visible reason — never a
 * silent substitution, because a user who chose Stack deserves to know why
 * they are not looking at it.
 */
export function Presenter(props: PresenterProps & { registry: PresenterRegistry }): React.ReactNode {
  const view = useViewState();
  const requested: PresentationMode = view.mode;
  const definition = props.registry.get(requested) ?? documentPresenter;
  const { Component } = definition;

  return (
    <>
      {definition.unsupportedReason ? (
        <p data-workplane="unsupported-mode" role="status">
          {definition.unsupportedReason} Showing Document instead.
        </p>
      ) : null}
      <Component controller={props.controller} />
    </>
  );
}
