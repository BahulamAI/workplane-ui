# Architecture decision records

Every public API change, document schema change, command semantics change,
security boundary change, or new mandatory dependency needs an ADR here plus
conformance fixtures, per [GOVERNANCE.md](../../GOVERNANCE.md).

## Decisions carried from PRD-108

These were decided in the PRD and are implemented or reserved as noted. They
are listed rather than restated; write a full ADR when one is **revisited**.

| ADR | Decision | Status |
|---|---|---|
| ADR-WP-001 | Headless TypeScript authority contracts; React reference shell | implemented |
| ADR-WP-002 | Persistent scenes/blocks with explicit data and artifact references | implemented |
| ADR-WP-003 | One authority, atomic commands, optimistic concurrency before CRDT | implemented |
| ADR-WP-004 | Reuse visualization engines behind adapter contracts | implemented (ECharts) |
| ADR-WP-005 | Catalog-based generated UI; arbitrary generated host code prohibited | implemented |
| ADR-WP-006 | Plugins and legacy panels coexist; Workplane is additive | reserved (M3) |
| ADR-WP-007 | Document, feed, and stack are presentations of the same document | partial — contract implemented, Document only |
| ADR-WP-008 | Scene browsing and revision history are distinct navigation domains | reserved (M3) |
| ADR-WP-009 | Manim is a job/artifact integration, not the UI runtime | reserved (M4) |
| ADR-WP-010 | Optional protocols and vendor integrations never become mandatory | implemented — enforced by `pnpm lint:boundaries` |
| ADR-WP-011 | Typed graph over stable addresses for hierarchy and cross-component references | **pending** — see PRD-108 section 27 |
| ADR-WP-012 | Who owns a renderer's visual grammar — ours, or the engine's | **proposed** — see [ADR-WP-012](ADR-WP-012-renderer-spec-ownership.md) |

## Open items

The PRD's approval checklist lists items that must be resolved before M1 is
signed off. They are open:

- Named owners for core/authority, React UX, Bahulam integration, data
  semantics, and security — see the table in [GOVERNANCE.md](../../GOVERNANCE.md).
- ~~npm scope and repository ownership.~~ **Resolved 2026-09-24:** keep the
  `@bahulam/workplane-*` names. The neutral `workplane` package and the
  `@workplane` scope are held by an unrelated active project
  (`sylonzero`, v0.4.3, "durable execution plane for routing work across
  trusted nodes"), so the neutral scope PRD section 7.1 hoped for is not
  obtainable. `workplane-ui` and `workplane-core` are free and were
  considered; the vendor scope was kept because we verifiably own `@bahulam`,
  nothing under it can be squatted, and no Bahulam name appears in any UI,
  runtime, document, or export — only in the import specifier. Branding does
  not affect host independence.
- Source licence clearance for anything vendored later.
- Supported browser baseline. The bundle budgets are measured
  (`tests/benchmarks`); the browser matrix is not yet.
- Which release first includes Stack mode.

## One gap found during implementation

PRD section 10.3 lists structure components — card, stack, responsive grid —
but the document model in section 8.1 gives a `Block` no way to reference
other blocks. A structure block currently has nothing to contain.

**Resolution in progress.** PRD-108 section 27 proposes a typed graph over
stable node addresses rather than a bare child reference, because the document
already expresses six kinds of relationship in six ad-hoc shapes: containment
(`scene.blockOrder`), data dependency (`block.dataRefs`), state dependency
(`block.bindings`), query derivation (runtime only), cross-highlighting (a
renderer-spec convention), and artifact provenance (a one-off field).

Unifying them gives `contains` for hierarchy, `reads` / `binds` for
dependency, `about` for entity grounding, `filters` / `highlights` for
section 13.2's explicit selection mapping, and `explains` / `produced-by` for
section 13.6 staleness and section 12.3 tracing.

Staged G0–G4 in the PRD. **G1 alone — `contains` edges plus `childOrder`,
migrating `blockOrder` — closes this gap** and unblocks the structure catalog.
This is a `workplane/1` → `workplane/2` schema change and needs ADR-WP-011
plus migration fixtures on both sides before any of it lands.
