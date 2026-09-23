# Protocol notes

The wire contract lives in `packages/protocol`: the transaction envelope,
operation set, actor shape, committed event, and error codes.

## Relationship to adjacent specifications

Workplane's command protocol is a **write** path with an authority behind it.
It is not a competitor to the agent-UI event protocols, and the overlap is
mostly complementary.

### AG-UI

AG-UI's state synchronisation uses a snapshot-delta pattern: `StateSnapshot`
for a full rebuild, `StateDelta` for incremental updates applied in order.
That is the same shape as the reference HTTP boundary in PRD section 12.2 —
`GET /workplanes/:id` for an authorized snapshot, `GET
/workplanes/:id/events?after=:revision` for bounded replay.

One useful detail: `StateDelta` carries **RFC 6902 JSON Patch** operations.
Workplane's `state.set` is deliberately narrower — a single registered, typed
path, authorized per write — but it is shape-compatible with JSON Patch
`replace`, so an AG-UI bridge is a mapping rather than a translation. The
narrowing is the point: generic JSON Patch against a document root would let a
proposal write `/revision` or `/dataSources`.

AG-UI's run lifecycle (`RunStarted` / `StepStarted` / `RunError`) maps onto
`Job` in `packages/core/src/host.ts`. Its `parentRunId`, used for branching and
time travel, is worth revisiting when the history navigation domain is built.

An adapter is reserved in `experimental/adapter-agui`.

### A2UI

A2UI and Workplane converged independently on the same document shape, which is
mild evidence that the shape is right:

| A2UI | Workplane |
|---|---|
| flat component list with id references | `blocks: Record<string, Block>` + `blockOrder` |
| client-held catalog of trusted components | `RendererRegistry`; `trust` assigned by the host |
| data model bound by path | `BindingRef { scope, path }`, JSON Pointer |
| `action: { event: { name } }`, never code | action id + typed arguments |
| `updateDataModel { path, value }` | `state.set { path, value }` |
| createSurface / updateComponents / updateDataModel | `scene.add` / `block.add`, `block.update` / `state.set` |

The substantive difference: A2UI components reference children by id, so a Card
can contain a Button. Workplane blocks are flat within a scene. See the gap
noted in [`../adr/README.md`](../adr/README.md).

An adapter is reserved in `experimental/adapter-a2ui`.

### MCP Apps / MCP-UI

A different embedding model — the server returns a UI resource that the host
renders in a sandbox. That maps to a future sandboxed embed *block*, not to the
document model. Reserved in `experimental/adapter-mcp-apps`.

## Versioning

Package versions, schema versions, and protocol versions move independently.
Package `0.3.0` does not imply document schema `3`. Every release declares which
schema versions and renderer profiles it is compatible with.
