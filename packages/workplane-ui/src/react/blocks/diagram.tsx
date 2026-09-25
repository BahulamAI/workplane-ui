import { useEffect, useRef, useState } from "react";
import type { RendererDefinition } from "../registry.js";
import { diagramContract, type DiagramSpec } from "../../renderers/index.js";

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
  ...diagramContract,
  Component: ({ spec, block }) => <DiagramComponent spec={spec} block={block} />,
};
