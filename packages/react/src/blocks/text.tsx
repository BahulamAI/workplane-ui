import type { JsonValue } from "@bahulam/workplane-protocol";
import type { RendererDefinition } from "../registry.js";
import { isObject } from "./shared.js";

interface TextSpec {
  text: string;
  /** Generated prose is labelled, so a reader can tell it from a bound fact. */
  generated?: boolean;
}

export const textRenderer: RendererDefinition<TextSpec> = {
  id: "workplane.text",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: false,
    selection: false,
    thumbnail: true,
    staticExport: true,
    suspend: false,
    requiresWebGL: false,
  },
  validate(spec: unknown) {
    if (!isObject(spec)) return { ok: false as const, message: "Spec must be an object" };
    if (typeof spec.text !== "string") {
      return { ok: false as const, message: '"text" must be a string', path: "/text" };
    }
    // Plain text only. There is no HTML path, so there is nothing to sanitize.
    return { ok: true as const, value: { text: spec.text, generated: spec.generated === true } };
  },
  summarize: (spec) => spec.text.slice(0, 200),
  Component: ({ spec }) => (
    <div data-workplane="text" data-generated={spec.generated ? "true" : undefined}>
      <p>{spec.text}</p>
      {spec.generated ? <span data-workplane="generated-badge">Generated</span> : null}
    </div>
  ),
};

interface FactSpec {
  /** `{name}` placeholders resolve from this block's declared bindings. */
  template: string;
}

/**
 * A bound fact: every value comes from a live binding, so the sentence cannot
 * drift out of agreement with the data the way generated prose does.
 */
export const factRenderer: RendererDefinition<FactSpec> = {
  id: "workplane.fact",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: false,
    selection: false,
    thumbnail: true,
    staticExport: true,
    suspend: false,
    requiresWebGL: false,
  },
  validate(spec: unknown) {
    if (!isObject(spec)) return { ok: false as const, message: "Spec must be an object" };
    if (typeof spec.template !== "string") {
      return { ok: false as const, message: '"template" must be a string', path: "/template" };
    }
    return { ok: true as const, value: { template: spec.template } };
  },
  summarize: (spec) => spec.template.slice(0, 200),
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
