# `renderer-json` — placeholder

Catalog-based generated-UI adapter around [`json-render`](https://github.com/vercel-labs/json-render).

**Not implemented.** Scheduled for evaluation in M0 and adoption in M2.

The decision this directory is reserved for is bounded: use `json-render` as
the implementation of an individual composed-UI block, **not** as the thing the
Workplane document model is defined around. Adopt it only once it passes the
controlled-state, accessibility, stream-validation, bundle, and
action-interception tests, measured against the small native implementation in
`packages/react/src/blocks`.

The Workplane controller stays authoritative either way. An adapter-local input
change becomes a local draft or a validated Workplane command — a second state
store must never commit a business value on its own.
