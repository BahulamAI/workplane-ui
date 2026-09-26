import { type HTMLAttributes, type ReactNode } from "react";
import { BlockProvider, SceneProvider, useActivity, useBlockContext, useSceneContext, useWorkplaneContext } from "./context.js";
import { BlockErrorBoundary } from "./error-boundary.js";
import { useBlockData, useControllerState, useSceneOrder } from "./hooks.js";
import type { RendererEvent } from "./registry.js";
import { Slot } from "./slot.js";

/**
 * Unstyled primitives. Every part renders a plain element unless `asChild` is
 * set, in which case its behaviour is merged onto your own element.
 *
 * This is what makes PRD 3.3 true in practice: a third-party host restyles or
 * replaces every visual decision here without forking the repository.
 */
type PartProps = HTMLAttributes<HTMLElement> & { asChild?: boolean };

// --- Workplane ------------------------------------------------------------

function WorkplaneRoot({ asChild, children, ...props }: PartProps): ReactNode {
  const Element = asChild ? Slot : "div";
  return (
    <Element data-workplane="root" {...props}>
      {children}
    </Element>
  );
}

function WorkplaneTitle({ asChild, ...props }: PartProps): ReactNode {
  const { document } = useControllerState();
  const Element = asChild ? Slot : "h1";
  return (
    <Element data-workplane="title" {...props}>
      {document?.title ?? ""}
    </Element>
  );
}

/** Renders `children` once per scene, in document order. */
function WorkplaneScenes({ children }: { children: ReactNode }): ReactNode {
  const sceneOrder = useSceneOrder();
  const { document } = useControllerState();
  return (
    <>
      {sceneOrder.map((sceneId) => {
        const scene = document?.scenes[sceneId];
        if (!scene) return null;
        return (
          <SceneProvider key={sceneId} value={scene}>
            {children}
          </SceneProvider>
        );
      })}
    </>
  );
}

/** Renders `children` only while a newer evaluation epoch is loading. */
function WorkplaneIfStale({ children }: { children: ReactNode }): ReactNode {
  const { epoch } = useControllerState();
  return epoch.stale ? <>{children}</> : null;
}

function WorkplaneIfEmpty({ children }: { children: ReactNode }): ReactNode {
  const sceneOrder = useSceneOrder();
  return sceneOrder.length === 0 ? <>{children}</> : null;
}

export const WorkplanePrimitive = {
  Root: WorkplaneRoot,
  Title: WorkplaneTitle,
  Scenes: WorkplaneScenes,
  IfStale: WorkplaneIfStale,
  IfEmpty: WorkplaneIfEmpty,
};

// --- Scene ----------------------------------------------------------------

function SceneRoot({ asChild, children, ...props }: PartProps): ReactNode {
  const scene = useSceneContext();
  const Element = asChild ? Slot : "section";
  return (
    <Element
      data-workplane="scene"
      data-scene-id={scene.id}
      data-layout={scene.layout}
      // A stable deep-link target that does not create a document revision.
      id={`scene-${scene.id}`}
      aria-labelledby={`scene-heading-${scene.id}`}
      {...props}
    >
      {children}
    </Element>
  );
}

function SceneHeading({ asChild, children, ...props }: PartProps): ReactNode {
  const scene = useSceneContext();
  const Element = asChild ? Slot : "h2";
  return (
    <Element data-workplane="scene-heading" id={`scene-heading-${scene.id}`} {...props}>
      {children ?? scene.title}
    </Element>
  );
}

function SceneBlocks({ children }: { children: ReactNode }): ReactNode {
  const scene = useSceneContext();
  const { document } = useControllerState();
  return (
    <>
      {scene.blockOrder.map((blockId) => {
        const block = document?.blocks[blockId];
        if (!block) return null;
        return (
          <BlockProvider key={blockId} value={block}>
            {children}
          </BlockProvider>
        );
      })}
    </>
  );
}

export const ScenePrimitive = {
  Root: SceneRoot,
  Heading: SceneHeading,
  Blocks: SceneBlocks,
};

// --- Block ----------------------------------------------------------------

function BlockRoot({ asChild, children, ...props }: PartProps): ReactNode {
  const block = useBlockContext();
  const Element = asChild ? Slot : "article";
  return (
    <Element
      data-workplane="block"
      data-block-id={block.id}
      data-renderer-id={block.rendererId}
      aria-label={block.title}
      {...props}
    >
      {children}
    </Element>
  );
}

function BlockTitle({ asChild, children, ...props }: PartProps): ReactNode {
  const block = useBlockContext();
  const Element = asChild ? Slot : "h3";
  return (
    <Element data-workplane="block-title" {...props}>
      {children ?? block.title}
    </Element>
  );
}

/**
 * The renderer itself. Resolves the block's renderer from the catalog,
 * validates its spec, and hands it a bounded projection.
 *
 * A missing renderer or an invalid spec renders `Fallback` — never nothing,
 * and never a crash that takes the document with it.
 */
function BlockContent({ onEvent }: { onEvent?: (event: RendererEvent, blockId: string) => void }): ReactNode {
  const block = useBlockContext();
  const { renderers } = useWorkplaneContext();
  const { results, bindings, stale, errors } = useBlockData();
  const activity = useActivity();

  const definition = renderers.get(block.rendererId);
  if (!definition) {
    return <BlockFallback reason="unsupported-renderer" />;
  }
  if (!definition.specVersions.includes(block.specVersion)) {
    return <BlockFallback reason="unsupported-version" />;
  }

  const validation = definition.validate(block.spec);
  if (!validation.ok) {
    return <BlockFallback reason="invalid-spec" detail={validation.message} at={validation.path} />;
  }

  // Nothing to show and a known reason: say the reason. Leaving the block
  // pending would render a spinner that never resolves, which is what an
  // unconfigured data source used to look like.
  if (results.size === 0 && errors.size > 0) {
    return <BlockFallback reason="data-unavailable" detail={[...errors.values()][0]} />;
  }

  const { Component } = definition;
  return (
    <BlockErrorBoundary
      blockId={block.id}
      fallback={(error) => <BlockFallback reason="render-error" detail={error.message} />}
    >
      <Component
        block={block}
        spec={validation.value}
        results={results}
        bindings={bindings}
        stale={stale}
        activity={activity}
        errors={errors}
        emit={(event) => onEvent?.(event, block.id)}
      />
    </BlockErrorBoundary>
  );
}

export type FallbackReason =
  | "unsupported-renderer"
  | "unsupported-version"
  | "invalid-spec"
  | "render-error"
  | "data-unavailable";

const RECOVERY: Record<FallbackReason, string> = {
  "unsupported-renderer": "Install or register this renderer to display the block.",
  "unsupported-version": "This block needs a newer version of its renderer.",
  "invalid-spec": "The block specification did not validate against its renderer schema.",
  "render-error": "The renderer failed. The rest of the document is unaffected.",
  "data-unavailable": "The underlying data is unavailable or access was revoked.",
};

/**
 * Accessible fallback: the block's title, its renderer id, its own declared
 * fallback text, and what to do about it. A reader must be able to tell what
 * is missing without seeing the chart.
 */
function BlockFallback({ reason, detail, at }: { reason: FallbackReason; detail?: string; at?: string }): ReactNode {
  const block = useBlockContext();
  return (
    <div data-workplane="block-fallback" data-reason={reason} role="status">
      <p data-workplane="fallback-text">{block.fallback}</p>
      <p data-workplane="fallback-detail">
        <code>{block.rendererId}</code> — {RECOVERY[reason]}
        {detail ? ` ${detail}` : ""}
        {/* Where, not just what. A validation message without a location leaves
            an author guessing which field of a large spec is at fault. */}
        {at ? <> at <code>{at}</code></> : null}
      </p>
    </div>
  );
}

export const BlockPrimitive = {
  Root: BlockRoot,
  Title: BlockTitle,
  Content: BlockContent,
  Fallback: BlockFallback,
};
