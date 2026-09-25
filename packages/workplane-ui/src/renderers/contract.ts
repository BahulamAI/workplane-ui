import type { JsonValue } from "../protocol/index.js";

/**
 * What a renderer must declare, independent of how it draws.
 *
 * Split from the React definition on purpose. The host is headless — it cannot
 * import a component to ask what a renderer accepts — so the contract has to be
 * reachable without React. Previously the host kept a hand-written catalog
 * beside the renderers, which is a second source of truth that drifted: it
 * advertised shapes the validators had stopped accepting.
 *
 * Every field here is required. Advertising is not optional: a renderer nobody
 * can discover is a renderer an agent will never use correctly.
 */
export interface RendererContract<TSpec = JsonValue> {
  id: string;
  specVersions: readonly string[];
  /**
   * Assigned by the HOST registry. A community manifest declaring itself
   * "host-reviewed" does not become trusted by saying so.
   */
  trust: "host-reviewed" | "sandboxed";
  capabilities: RendererCapabilities;
  /** One line telling an agent whether this is the right block. */
  purpose: string;
  /**
   * A real specification this renderer accepts.
   *
   * Required, and tested: the conformance suite runs it through `validate`. An
   * example cannot drift from the validator the way a description can, and an
   * agent gets something to copy rather than something to interpret.
   */
  example: JsonValue;
  /** A second example where one shape does not convey the choice. */
  alternateExample?: JsonValue;
  /** Peer dependency a host must install. */
  requires?: string;
  validate(spec: unknown): ValidationOutcome<TSpec>;
  /** Bounded plain text for agent context. Never the full spec. */
  summarize(spec: TSpec): string;
}

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
 * Compact catalog text for a tool description or agent context.
 *
 * Takes descriptors rather than contracts so a host can describe the subset it
 * actually registered — advertising a renderer the panel cannot draw produces a
 * block that validates and then renders as a placeholder, which is worse than
 * not offering it. A contract is a descriptor, so either may be passed.
 */
export function describeCatalog(contracts: readonly RendererDescriptor[]): string {
  return contracts
    .map((contract) => {
      const lines = [
        `  ${contract.id}${contract.requires ? ` (needs ${contract.requires})` : ""}`,
        `    ${contract.purpose}`,
        // The example is the contract. It is tested against the validator, so
        // unlike prose it cannot quietly stop being true.
        `    example: ${JSON.stringify(contract.example)}`,
      ];
      if (contract.alternateExample) lines.push(`    or: ${JSON.stringify(contract.alternateExample)}`);
      return lines.join("\n");
    })
    .join("\n");
}

/** The shape a host publishes: everything but the functions. */
export interface RendererDescriptor {
  id: string;
  specVersions: readonly string[];
  trust: "host-reviewed" | "sandboxed";
  purpose: string;
  example: JsonValue;
  alternateExample?: JsonValue;
  requires?: string;
  capabilities: RendererCapabilities;
}

export function toDescriptor(contract: RendererContract<never>): RendererDescriptor {
  return {
    id: contract.id,
    specVersions: contract.specVersions,
    trust: contract.trust,
    purpose: contract.purpose,
    example: contract.example,
    ...(contract.alternateExample !== undefined ? { alternateExample: contract.alternateExample } : {}),
    ...(contract.requires !== undefined ? { requires: contract.requires } : {}),
    capabilities: contract.capabilities,
  };
}
