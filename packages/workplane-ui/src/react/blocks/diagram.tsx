import { useEffect, useRef, useState } from "react";
import { sanitizeSpec, type KeyTree } from "../../core/index.js";
import type { RendererDefinition } from "../registry.js";

/**
 * Mermaid diagrams — architecture, sequence, flow, state, ER.
 *
 * Mermaid is LAZY-LOADED. It is large relative to the section 20 shell budget
 * and most documents contain no diagram, so a document without one must not pay
 * for it. A host that never registers this renderer never loads it at all.
 *
 * `securityLevel: "strict"` is not optional here: the source is
 * agent-authored, and strict mode is what stops a label becoming markup or a
 * click handler. The rendered SVG is inserted as markup — that is the one place
 * in this codebase where that happens, and it is why the library's own
 * sanitizer must be on.
 */
interface DiagramSpec {
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

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "failed"; message: string };

let mermaidModule: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
  // One import per page, shared by every diagram block.
  mermaidModule ??= import("mermaid");
  return mermaidModule;
}

let diagramCounter = 0;

function DiagramComponent({ spec, block }: { spec: DiagramSpec; block: { id: string; title: string; fallback: string } }) {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const idRef = useRef(`wp-diagram-${(++diagramCounter).toString(36)}`);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const { default: mermaid } = await loadMermaid();
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: typeof window !== "undefined"
            && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "default",
        });
        const { svg } = await mermaid.render(idRef.current, spec.diagram);
        if (!cancelled) setState({ status: "ready", svg });
      } catch (error) {
        if (!cancelled) {
          // A malformed diagram is an authoring error, and the source is more
          // useful to whoever must fix it than a rendering stack trace.
          setState({ status: "failed", message: (error as Error).message });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [spec.diagram]);

  if (state.status === "failed") {
    return (
      <div data-workplane="diagram" data-state="error" role="status">
        <p>This diagram could not be drawn: {state.message}</p>
        <details>
          <summary>Diagram source</summary>
          <pre data-workplane="code"><code>{spec.diagram}</code></pre>
        </details>
      </div>
    );
  }

  return (
    <figure data-workplane="diagram" data-state={state.status}>
      {state.status === "ready" ? (
        <div
          role="img"
          aria-label={spec.alt}
          // The only markup insertion in the codebase. Mermaid produced it
          // under securityLevel "strict"; the source reached it through the
          // envelope and is never executed here.
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : (
        <div data-workplane="diagram-loading" aria-label={block.fallback}>Drawing diagram…</div>
      )}
      <figcaption>{spec.caption ?? spec.alt}</figcaption>
      <details data-workplane="diagram-source">
        <summary>Diagram source</summary>
        <pre data-workplane="code"><code>{spec.diagram}</code></pre>
      </details>
    </figure>
  );
}

export const diagramRenderer: RendererDefinition<DiagramSpec> = {
  id: "workplane.diagram",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: false, selection: false, thumbnail: true,
    staticExport: true, suspend: true, requiresWebGL: false,
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
  Component: ({ spec, block }) => <DiagramComponent spec={spec} block={block} />,
};
