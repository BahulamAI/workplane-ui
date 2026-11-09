import { useEffect, useState } from "react";
import type { Block } from "../core/index.js";
import type { DataProvider, QueryRequest, QueryResult } from "../data/index.js";
import { BlockErrorBoundary } from "./error-boundary.js";
import type { RendererEvent, RendererRegistry } from "./registry.js";

export interface ResultBlockProps {
  block: Block;
  revision: string;
  registry: RendererRegistry;
  provider: DataProvider;
  request: Omit<QueryRequest, "signal" | "generation">;
  /** Host-issued authorization partition; never taken from an agent spec. */
  partition: string;
  onEvent?: (event: RendererEvent) => void;
}

/** Embed one persisted result in chat without creating a second document authority. */
export function ResultBlock(props: ResultBlockProps): React.ReactNode {
  // A changed identity discards prior data synchronously, before the next effect.
  const key = JSON.stringify([props.partition, props.revision, props.block, props.request]);
  return <BlockErrorBoundary blockId={key} fallback={() => <p role="alert">This view could not be rendered.</p>}>
    <ResultBlockContent key={key} {...props} />
  </BlockErrorBoundary>;
}

function ResultBlockContent({ block, revision, registry, provider, request, partition, onEvent }: ResultBlockProps): React.ReactNode {
  const [result, setResult] = useState<QueryResult>();
  const [error, setError] = useState<string>();
  const renderer = registry.get(block.rendererId);
  const validated = renderer?.validate(block.spec);
  const supported = !!renderer?.specVersions.includes(block.specVersion) && validated?.ok;
  const queryKey = JSON.stringify(request);
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    setResult(undefined);
    setError(undefined);
    provider.execute({ ...request, generation: 1, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.partition !== partition || value.queryId !== request.queryId || value.generation !== 1) {
        throw new Error("Result identity mismatch");
      }
      if (value.rows.length > 1000 || value.columns.length > 50 || value.rows.some(row => row.length !== value.columns.length)) {
        throw new Error("Result exceeds inline limits or has invalid rows");
      }
      setResult(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Result unavailable. It may have expired or access may have changed.");
    });
    return () => controller.abort();
  }, [provider, queryKey, partition, revision, supported]);
  if (!supported || !renderer || !validated?.ok) return <p role="alert">Unsupported presentation. {block.fallback}</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p role="status">Loading analysis result…</p>;
  if (!result.rows.length) return <p>No rows returned for this analysis.</p>;
  const Component = renderer.Component;
  return <section aria-label={block.title} data-workplane="inline-result">
    <p>{block.title}</p>
    <p>Source version: {result.sourceVersion} · Freshness: {result.freshness}</p>
    <Component block={block} spec={validated.value} results={new Map([[result.queryId, result]])}
      bindings={{}} stale={result.freshness === "stale"} activity="active" errors={new Map()}
      emit={event => onEvent?.(event)} />
  </section>;
}
