# Workplane

**Persistent interactive workspaces for people and agents.**

A Workplane is a versioned, persistent interactive document containing ordered
scenes and addressable blocks. A user and an agent operate on the same logical
document through the same validated command gateway — so a click and a model
proposal traverse identical validation, authorization, and approval policy.

Workplane is a headless TypeScript document/runtime library with a React
reference UI and replaceable renderer adapters. Bahulam is the first host, not a
runtime dependency.

> **Status: pre-alpha (M1).** The vertical slice below is implemented and tested.
> Everything else in [the PRD](docs/prd/) is a proposed contract, not a shipped
> feature. See [Milestones](#milestones) for what is and is not built.

## Quick start — no key, no network, no account

```bash
pnpm install
pnpm build
pnpm dev      # http://localhost:5173
```

The demo runs on a synthetic Azure-cost fixture. It makes no network call, reads
no credential, and invokes no model.

Try the loop it exists to prove:

1. Switch the environment filter to **Production** — the metric, bar chart, and
   table update together, in one evaluation epoch.
2. Click a service bar — the table filters, the chart highlights rather than
   filtering, and the selection is a committed document change.
3. Change the reduction assumption from **20% → 30%** — savings move
   `1,200 → 1,800` and projected cost `8,800 → 8,200`, deterministically, with
   **zero model calls**.
4. Press **Run scripted agent** — an agent appends a comparison scene through
   the same command gateway. Your unsubmitted draft survives.
5. Reload the page — document, revision, and view preferences all come back.

## Packages

| Package | Purpose | Depends on |
|---|---|---|
| `@bahulam/workplane-core` | Document types, invariant validator, pure reducer, command gateway, session store | nothing |
| `@bahulam/workplane-protocol` | Wire schemas, transaction envelope, error codes | nothing |
| `@bahulam/workplane-data` | Query/result contracts, dependency graph, evaluation epochs, minor-unit money | protocol |
| `@bahulam/workplane-react` | Provider, hooks, renderer registry, native block catalog, Document presenter | core, data, react (peer) |
| `@bahulam/workplane-renderer-echarts` | BI chart adapter with normalized selection events | core, react, echarts (peer) |
| `@bahulam/workplane-testkit` | Fixtures and conformance helpers | core, data |

The headless core imports no React, no chart engine, no model SDK, no Node
filesystem API, and no Bahulam package. `pnpm lint:boundaries` enforces this.

## Architecture in one paragraph

The core defines state transitions. The host enforces trust and supplies
execution through `HostServices`. Renderers display a bounded projection and
emit normalized events. An agent proposes changes through the same command
boundary as a user. All durable changes enter one command gateway, which
authenticates the actor, validates the whole transaction, checks the expected
revision, applies operations to a copy, validates the resulting invariants,
persists atomically, and only then broadcasts a committed event.

See [docs/concepts/](docs/concepts/) and [docs/adr/](docs/adr/).

## Milestones

| Milestone | Status | Contents |
|---|---|---|
| M1 — independent vertical slice | **implemented** | Core schema/reducer/gateway, native React blocks, synthetic data, Document mode, local persistence |
| M2 — generative BI + feed | partial | ECharts selection and deterministic queries are in; Feed presenter and scoped agent tools are not |
| M3 — stack and Bahulam adoption | not started | `packages/adapter-bahulam` is a placeholder |
| M4 — mixed media and OSS beta | not started | `packages/renderer-media` is a placeholder |
| M5 — evidence-led extensions | not started | `experimental/` directories are empty placeholders |

Directories under `experimental/` express architectural boundaries. They contain
no code and are not published.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports go through
[SECURITY.md](SECURITY.md) — please do not open a public issue for a
vulnerability.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
