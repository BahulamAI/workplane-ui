import type { JsonValue } from "../../protocol/index.js";
import type { RendererDefinition } from "../registry.js";
import { factContract, textContract, type FactSpec, type TextSpec } from "../../renderers/index.js";

export const textRenderer: RendererDefinition<TextSpec> = {
  ...textContract,
  Component: ({ spec }) => (
    <div data-workplane="text" data-generated={spec.generated ? "true" : undefined}>
      <p>{spec.text}</p>
      {spec.generated ? <span data-workplane="generated-badge">Generated</span> : null}
    </div>
  ),
};

/**
 * A bound fact: every value comes from a live binding, so the sentence cannot
 * drift out of agreement with the data the way generated prose does.
 */
export const factRenderer: RendererDefinition<FactSpec> = {
  ...factContract,
  Component: ({ spec, bindings }) => {
    const text = spec.template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value: JsonValue | undefined = bindings[name];
      return value === undefined ? match : String(value);
    });
    return (
      <p data-workplane="fact">
        {text}
      </p>
    );
  },
};
