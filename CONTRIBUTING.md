# Contributing to Workplane

## Before you write code

Workplane deliberately owns a small surface: the persistent composition,
shared-state semantics, permission boundaries, and the plugin contract. It
reuses rendering engines rather than building another one. A change that pulls
rendering, querying, or model orchestration into the core will be declined on
architecture grounds, however good the code is.

Two rules catch most of it:

1. **The headless core imports nothing.** No React, no chart engine, no model
   SDK, no Node filesystem API, no database driver, no Bahulam package. Run
   `pnpm lint:boundaries` before you push.
2. **There is one command gateway.** A renderer's local state cannot become a
   second source of truth. If your feature needs to write durable state, it
   compiles into a transaction like everything else.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint:boundaries
```

`pnpm dev` runs the generative-BI example against the synthetic fixture.

## What a good pull request contains

- A vertical slice, not a broad rewrite. Land the reducer change, its tests, and
  its migration note together.
- Tests at the right layer. Reducers, pointers, validation, dependency
  evaluation, selection mapping, and rounding are unit-tested. Every storage,
  renderer, data, job, and host adapter has contract tests.
- For a public API change: an ADR in `docs/adr/` and conformance fixtures.
- For a new renderer: a schema, examples, event payloads, size limits, and a
  pass against the renderer conformance suite in `packages/testkit`.

Schema-valid is not semantically valid. If your change touches the document
model, add tests for referential integrity, ID uniqueness, membership,
typed write paths, and size limits — not just JSON Schema validation.

## New renderers

Register a new component only when an actual plugin needs it. We would rather
have six well-specified blocks than forty speculative ones. Renderer-native
spec fields are namespaced and versioned so an adapter can be replaced with an
explicit migration.

## Sign-off

Sign commits off with `git commit -s` (Developer Certificate of Origin). Any
heavier contribution requirement needs sponsor legal review and would be
announced before it applied.

## Conduct

This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
