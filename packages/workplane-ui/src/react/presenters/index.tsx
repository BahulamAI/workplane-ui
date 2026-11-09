import type { PresentationMode } from "../../core/index.js";
import { useViewState } from "../hooks.js";
import type { PresenterDefinition, PresenterProps } from "../registry.js";
import { documentPresenter } from "./document.js";
import { feedPresenter } from "./feed.js";
import { createStackPresenter } from "./stack.js";

export { documentPresenter, feedPresenter };
export { createStackPresenter, stackPresenter } from "./stack.js";
export { claimsGestures, useRendererEvents } from "./events.js";

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
 * All three presentations of section 5.4.
 *
 * `stackDepth` is how a host configures the preview depth "within a safe limit"
 * per 5.4.4 — decided once, at registration, rather than on every render.
 */
export function createPresenterRegistry(options?: { stackDepth?: number }): PresenterRegistry {
  return new PresenterRegistry()
    .register(documentPresenter)
    .register(feedPresenter)
    .register(createStackPresenter(options?.stackDepth ? { depth: options.stackDepth } : undefined));
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
