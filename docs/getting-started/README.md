# Getting started

## Run the demo

```bash
pnpm install
pnpm build
pnpm dev      # http://localhost:5173
```

No key, no account, no network call, no model.

## Wire it up yourself

Five things have to exist before a Workplane renders. They are separate on
purpose — each one is a boundary a host replaces independently.

```ts
import {
  LocalAuthority, MemoryStorage, WorkplaneController, createDocument,
} from "@bahulam/workplane-core";
import { createNativeRegistry, createPresenterRegistry } from "@bahulam/workplane-react";

// 1. A document.
const document = createDocument({ id: "wp_demo", title: "My workspace" });

// 2. Storage. Must commit document + event + receipt atomically.
const storage = new MemoryStorage(document);

// 3. A policy. Everything a user or agent may write is registered and typed;
//    anything absent is rejected by the authority, not hidden by the UI.
const policy = {
  structuralCapability: "workplane.edit",
  writablePaths: [{ path: "/filters/period", type: "string" as const }],
};

// 4. The authority. The single writer.
const authority = new LocalAuthority({ storage, policy });

// 5. A controller, tying the authority to a data provider and a session.
const controller = new WorkplaneController({
  gateway: authority,
  documentId: "wp_demo",
  actor: { id: "u1", type: "user", capabilities: ["workplane.edit"] },
  provider: myDataProvider,
});
await controller.load();
```

Then render:

```tsx
<WorkplaneProvider controller={controller} renderers={createNativeRegistry()}>
  <Presenter controller={controller} registry={createPresenterRegistry()} />
</WorkplaneProvider>
```

## Restyling without forking

`<Presenter>` is a styled default built from unstyled primitives. To take over
the markup, compose the primitives directly — every part accepts `asChild`, so
its behaviour merges onto your own element:

```tsx
<WorkplanePrimitive.Root>
  <WorkplanePrimitive.Scenes>
    <ScenePrimitive.Root asChild>
      <section className="your-card">
        <ScenePrimitive.Heading asChild><h2 className="your-h2" /></ScenePrimitive.Heading>
        <ScenePrimitive.Blocks>
          <BlockPrimitive.Root>
            <BlockPrimitive.Title />
            <BlockPrimitive.Content />
          </BlockPrimitive.Root>
        </ScenePrimitive.Blocks>
      </section>
    </ScenePrimitive.Root>
  </WorkplanePrimitive.Scenes>
</WorkplanePrimitive.Root>
```

No Bahulam navigation or branding appears in any of it. The default theme is
CSS custom properties in `@bahulam/workplane-react/styles.css`; redefine the
tokens rather than overriding rules.

## Writing a renderer

See [`../../examples/generative-bi/src/scenario-renderer.tsx`](../../examples/generative-bi/src/scenario-renderer.tsx)
for a complete one, and `packages/testkit` for the conformance suite it must
pass. The short version: validate the spec yourself, return a typed value,
summarize in bounded plain text, and emit normalized events instead of
committing anything.
