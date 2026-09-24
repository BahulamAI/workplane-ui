# @bahulam/workplane-ui

**Persistent interactive workspaces for people and agents.**

A Workplane is a versioned, persistent interactive document of ordered scenes
and addressable blocks. A user and an agent operate on the same document through
the same validated command gateway — so a click and a model proposal traverse
identical validation, authorization, and approval policy.

Headless TypeScript document authority with a React reference shell and
replaceable renderer adapters. Bahulam is the first host, not a runtime
dependency: no account, cloud gateway, hosted model, or network call is required.

> **Pre-alpha (milestone M1).** The vertical slice below is implemented and
> tested. Feed and Stack presentations, media/job blocks, and the Bahulam
> plugin bridge are specified but not built.

## Install

```bash
npm i @bahulam/workplane-ui
```

Zero runtime dependencies. `react`, `react-dom`, and `echarts` are **optional**
peers — install only what the entry points you use require.

## Entry points

| Import | Contents | Needs |
|---|---|---|
| `@bahulam/workplane-ui` | document model, invariant validator, pure reducer, command gateway, policy, session store, controller, query/data contracts | nothing |
| `@bahulam/workplane-ui/react` | provider, hooks, unstyled `asChild` primitives, native block catalogue, Document presenter | `react` |
| `@bahulam/workplane-ui/echarts` | BI chart adapter with normalized selection events | `echarts`, `react` |
| `@bahulam/workplane-ui/bahulam` | Bahulam host adapter: plugin-state storage, command transport, tool-backed data provider, legacy widget import | nothing |
| `@bahulam/workplane-ui/testkit` | fixtures and the gateway conformance suite, for adapter authors | nothing |
| `@bahulam/workplane-ui/styles.css` | default theme as CSS custom properties | — |

The headless entry imports no React and no chart engine, so a server, a CLI, or
a non-React host installs only what it needs. That boundary is enforced
mechanically, not by convention.

## Minimal use

```ts
import {
  createDocument, LocalAuthority, MemoryStorage, WorkplaneController,
} from "@bahulam/workplane-ui";

const document = createDocument({ id: "wp_demo", title: "My workspace" });

// Everything a user or agent may write is registered and typed. A path absent
// from this policy is rejected by the authority, not merely hidden in the UI.
const policy = {
  structuralCapability: "workplane.edit",
  writablePaths: [
    { path: "/filters/period", schema: { type: "string", enum: ["2026-07", "2026-08"] } },
  ],
} as const;

const authority = new LocalAuthority({ storage: new MemoryStorage(document), policy });

const controller = new WorkplaneController({
  gateway: authority,
  documentId: "wp_demo",
  actor: { id: "u1", type: "user", capabilities: ["workplane.edit"] },
  provider: myDataProvider,
});
await controller.load();
```

```tsx
import { WorkplaneProvider, Presenter, createNativeRegistry, createPresenterRegistry }
  from "@bahulam/workplane-ui/react";
import "@bahulam/workplane-ui/styles.css";

<WorkplaneProvider controller={controller} renderers={createNativeRegistry()}>
  <Presenter controller={controller} registry={createPresenterRegistry()} />
</WorkplaneProvider>
```

## Restyling without forking

`Presenter` is a styled default built from unstyled primitives. To own the
markup, compose the primitives directly — every part takes `asChild`, merging
its behaviour onto your element:

```tsx
import { WorkplanePrimitive, ScenePrimitive, BlockPrimitive } from "@bahulam/workplane-ui/react";

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

No Bahulam navigation or branding appears in any of it. The theme is CSS custom
properties — redefine tokens rather than overriding rules.

## Architecture in one paragraph

The core defines state transitions. The host enforces trust and supplies
execution through `HostServices`. Renderers display a bounded projection and
emit normalized events. An agent proposes changes through the same command
boundary as a user. All durable changes enter one command gateway, which
authenticates the actor, validates the whole transaction, checks the expected
revision, applies operations to a copy, validates the resulting invariants,
persists atomically, and only then broadcasts a committed event.

## Writing an adapter

`@bahulam/workplane-ui/testkit` exports `runGatewayConformance`, which any
`CommandGateway` must pass — revision arithmetic, `CONFLICT` reporting,
idempotent replay, `IDEMPOTENCY_MISMATCH`, transaction atomicity,
unregistered-path refusal, agent/user policy parity, bounded event replay,
provenance, and subscription lifecycle. If a transport can change the meaning
of a command, it fails the suite.

## Licence

Apache-2.0. Source, issues, and docs:
<https://github.com/BahulamAI/workplane-ui>
