import { sanitizeSpec, type KeyTree } from "../core/index.js";
import type { RendererContract } from "./contract.js";

/**
 * The Mermaid diagram contract.
 *
 * Headless: an agent must be able to learn what a diagram block accepts even on
 * a host that never installs Mermaid. The component — and the lazy import of
 * the library — lives in `../react/blocks/diagram.tsx`.
 */
export interface DiagramSpec {
  /** Mermaid source. Arrows and labels, not code. */
  diagram: string;
  caption?: string;
  /** Accessible description, since an SVG of boxes tells a screen reader little. */
  alt: string;
}

const DIAGRAM_ALLOW: KeyTree = {
  // $verbatim: mermaid source contains `-->` and `==>`, which the generic
  // script heuristic would otherwise reject. It is handed to mermaid, never
  // evaluated by us.
  diagram: { $verbatim: true },
  caption: true,
  alt: true,
};

/** Diagram kinds this adapter will render. Anything else is refused by name. */
const KINDS = [
  "graph", "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram",
  "stateDiagram-v2", "erDiagram", "journey", "gantt", "pie", "mindmap", "timeline",
];

export const diagramContract: RendererContract<DiagramSpec> = {
  id: "workplane.diagram",
  specVersions: ["1"],
  trust: "host-reviewed",
  requires: "mermaid",
  capabilities: {
    interactive: false, selection: false, thumbnail: true,
    staticExport: true, suspend: true, requiresWebGL: false,
  },
  purpose:
    "A Mermaid diagram: architecture, sequence, flow, state, ER. Use this to show structure or " +
    "order of events. `alt` is REQUIRED — an SVG of boxes tells a screen reader nothing.",
  example: {
    diagram:
      "flowchart LR\n  Client --> LB[Load balancer]\n  LB --> App1[App server 1]\n  LB --> App2[App server 2]\n  App1 --> DB[(Database)]\n  App2 --> DB",
    alt: "A client reaching a load balancer, which fans out to two app servers sharing one database.",
    caption: "Horizontal scaling behind a load balancer",
  },
  validate(spec: unknown) {
    const result = sanitizeSpec<DiagramSpec>(spec, {
      allow: DIAGRAM_ALLOW,
      limits: { maxDepth: 3, maxNodes: 32, maxBytes: 64 * 1024, maxArrayLength: 4, maxStringLength: 32 * 1024 },
    });
    if (!result.ok) {
      const first = result.violations[0]!;
      return { ok: false as const, message: first.message, path: first.path };
    }
    if (typeof result.value !== "object" || result.value === null || Array.isArray(result.value)) {
      return { ok: false as const, message: "Spec must be an object" };
    }
    const source = result.value.diagram;
    if (typeof source !== "string" || source.trim().length === 0) {
      return { ok: false as const, message: '"diagram" must be Mermaid source', path: "/diagram" };
    }
    const first = source.trim().split(/\s|\n/)[0] ?? "";
    if (!KINDS.includes(first)) {
      return {
        ok: false as const,
        message: `Diagram must start with a supported kind: ${KINDS.join(", ")}. Found "${first}".`,
        path: "/diagram",
      };
    }
    if (typeof result.value.alt !== "string" || result.value.alt.trim().length === 0) {
      return {
        ok: false as const,
        // An SVG of unlabelled boxes conveys nothing to a screen reader, and a
        // diagram is usually the part of a lesson that carries the idea.
        message:
          '"alt" is required: describe what the diagram shows, for readers who cannot see it.',
        path: "/alt",
      };
    }
    return { ok: true as const, value: result.value };
  },
  summarize: (spec) => `${spec.diagram.trim().split(/\s|\n/)[0]} diagram: ${spec.alt.slice(0, 120)}`,
};
