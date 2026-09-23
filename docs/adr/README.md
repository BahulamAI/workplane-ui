# Architecture decision records

Every public API change, document schema change, command semantics change,
security boundary change, or new mandatory dependency needs an ADR here plus
conformance fixtures, per [GOVERNANCE.md](../../GOVERNANCE.md).

## Decisions carried from PRD-WP-001

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

## Open items

The PRD's approval checklist lists items that must be resolved before M1 is
signed off. They are open:

- Named owners for core/authority, React UX, Bahulam integration, data
  semantics, and security — see the table in [GOVERNANCE.md](../../GOVERNANCE.md).
- npm scope and repository ownership.
- Source licence clearance for anything vendored later.
- Supported browser baseline. The bundle budgets are measured
  (`tests/benchmarks`); the browser matrix is not yet.
- Which release first includes Stack mode.

## One gap found during implementation

PRD section 10.3 lists structure components — card, stack, responsive grid —
but the document model in section 8.1 gives a `Block` no way to reference
child blocks. A2UI solves the same problem with child references by id. A
structure block currently has nothing to contain. This needs a decision before
those components are built: either add child references to `Block`, or drop
the structure row from the catalog and let scene layout carry it.
