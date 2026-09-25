# ADR-WP-012: Who owns a renderer's visual grammar

**Status:** **Accepted** — decided by PRD-108 section 28 (VC-05), 2026-09-24.
Option C was chosen. Implementation tracked as WP-020, demonstrated by AC-24
and AC-29.
**Date:** 2026-09-24
**Relates to:** PRD-108 sections 8.2, 10.1, 10.3, 10.4, 14.4, 19.2, 20

## The question

When an agent asks for a chart, whose vocabulary does it write in — ours, or the
rendering engine's?

## What triggered this

An agent was asked to project Azure costs for the rest of the year. It wanted a
line chart showing actual daily spend overlaid with three projection scenarios,
with actuals solid and projections dashed.

It could not express that. The chart spec is single-series by construction:

```ts
{ chartType: "bar" | "line" | "pie",
  queryId, categoryColumn, valueColumn }     // one series, one value column
```

No `series[]`, no line style, no per-series colour. Actual-versus-scenario is
among the most ordinary things a BI tool is asked for, and the spec cannot say
it. Section 10.3 lists "bar/line chart" and "simple comparison" and never says
multi-series, so this was built to specification and the specification was
wrong.

## The forces

**This is not only about charts.** The renderer roster is already ECharts,
Vega-Lite (P1), Plotly (P2), deck.gl (P2), React Flow (P2), Three.js, and Manim,
and section 14.4 anticipates more. Any answer that requires us to define and
maintain a visual grammar has to be paid for once per engine, forever.

Section 14.4 states the position plainly:

> Do not create a lowest-common-denominator chart format that claims lossless
> conversion among all engines. Standardize data references, selection IDs,
> actions, lifecycle, accessibility, and provenance. Preserve engine-specific
> specifications inside versioned adapter envelopes.

Constraints that cannot be traded away:

| Constraint | Source |
|---|---|
| No executable content, no arbitrary URLs, in any spec | 8.2, 10.1 |
| A renderer receives a bounded projection, never the host or a connection | 10.1 |
| Native spec fields are namespaced and versioned; replacement is an explicit migration | 10.4 |
| Series must be distinguishable without relying on colour | 20 (WCAG 2.2 AA) |
| Validate size, depth and limits before anything is accepted | 19.2 |
| Trust is assigned by the host registry, never self-asserted | 10.1 |

## Options

### A. We define the grammar

Extend our spec with `series[]`, `style`, `color`, `axis`, and grow it as needs
appear.

- Engine-neutral: a Vega-Lite adapter could honour the same spec.
- We maintain a chart grammar forever, and chase every engine's features.
- Each new engine reopens the question of what the grammar should contain.
- This is precisely what 14.4 forbids.

### B. Adopt Vega-Lite as the grammar

Use a published grammar of graphics instead of inventing one.

- Real, documented, stable. Multi-series, scales, and legends are free.
- Agents are likely to know it, so there is less schema to teach.
- Adds a second rendering engine alongside ECharts. **Bundle cost is
  unverified** and must be measured before this is chosen; it is believed to be
  substantial relative to our 250 KB shell budget in section 20.
- Vega-Lite carries `expr` strings, which would need subsetting before an agent
  may write them.
- Section 14.4 ranks it P1 *after* ECharts conformance, which is not finished.
- Does not answer Three.js or Manim, which have no grammar of graphics at all.

### C. The engine owns its vocabulary, behind an envelope we own

Workplane standardises the envelope and the safety properties. Each adapter
accepts its own engine's vocabulary, validated by its own published schema.

We own, once, for every adapter:

- which renderer, from a host-assigned catalog
- data references — `queryId` or inline literals; **a renderer never fetches**
- normalised selection and entity ids
- lifecycle: mount, update, suspend, thumbnail, dispose
- an accessible text equivalent
- provenance: source version, input fingerprint, staleness
- limits: bytes, depth, array lengths, series and point counts
- a generic safety validator: no executable content, no URLs, no prototype keys,
  closed key set per adapter

We own nothing about how a chart looks. ECharts speaks ECharts. Vega-Lite
speaks Vega-Lite. Three.js takes a scene graph. Manim takes a job spec. **No
translation between them, ever.**

- A new engine costs an adapter and a schema, not a grammar negotiation.
- Multi-series, dashed lines, per-series colour arrive immediately as the
  engine's own vocabulary.
- The document then contains engine-specific JSON, so replacing an adapter is an
  explicit migration. Section 10.4 sanctions this; it is the price.
- Each adapter's allowlist is real ongoing work, proportional to how much of the
  engine's surface is exposed.

### D. Split by trust

Agents get a narrow safe spec; host-reviewed plugin code may supply the full
engine vocabulary.

- Matches 10.1's trust model.
- Two spec surfaces per adapter to build, document, and test.
- Does not remove the need for a narrow grammar, so it inherits A's cost.

## Decision

PRD-108 section 28 settles this. VC-05:

> Workplane owns the common envelope and safety properties. Renderer-native
> specifications retain the engine's visual vocabulary; a common chart grammar
> must not constrain complex visuals to features shared by all engines.

VC-06 adds that adapters must be installable, registerable, discoverable and
loadable under host policy, and usable by every presenter without
engine-specific logic in the presenters. That rules out options A, B and D as
the primary model.

**Option C**, with two additions:

1. **A non-colour distinction is required** when a chart has more than one
   series — a dash pattern or a marker shape. This is a rule on the envelope,
   not a grammar of our own, and it is a WCAG 2.2 AA obligation under section
   20, not a stylistic preference.
2. **A compatibility shim** keeps today's single-series specs valid, so the
   change is additive rather than a migration on documents that already exist.

The envelope in option C has to be built regardless of what is decided about
charts, because Three.js and Manim need exactly the same guarantees — no
executable content, no fetching, bounded size, a text equivalent, declared
capabilities. Building it as a generic mechanism is what stops each new engine
from becoming its own argument.

## Consequences if adopted

- `packages/workplane-ui/src/renderer-echarts` stops defining a chart spec and
  starts validating an ECharts option subset.
- Every renderer publishes a JSON Schema, discoverable through the agent
  catalog, so an agent can check its own proposal before committing.
- Documents become less portable between engines and the trade is explicit.
- Adding Plotly, deck.gl, or React Flow becomes an adapter plus an allowlist.

## Open questions

1. How much of the ECharts option surface should the first allowlist expose?
   Starting narrow — series, axes, grid, legend, tooltip, colour — and widening
   on evidence would be consistent with section 10.3's "register more components
   only when an actual plugin needs it".
2. Should the agent-facing and plugin-facing surfaces differ, as in option D, or
   stay identical for now?
3. Does the accessibility rule reject a commit, or warn and render? Rejecting is
   consistent with how every other invariant behaves.
