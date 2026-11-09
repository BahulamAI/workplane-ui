# Portable chat charts

Workplane owns the data-only chart contract and the ECharts renderer. Bahulam's
web chat, desktop web surface, workspace panels, and native mobile WebView consume
that contract. This integration does not create another document/storage authority.
Existing `bahulam_render_v1` chart messages remain compatible. New output also
includes `contract_version: workplane.chat-chart/1`.

## Agent interface

`list_chart_presentations` returns the supported types, purpose, themes, limits,
and JSON tool schema. The conversational agent chooses a presentation and calls
`render_chart` with computed data. Jev does not choose charts or review their data;
its intent/safety inputs remain user/assistant conversation text and text history.
Structural validation rejects malformed, nonfinite, oversized, or unsupported data.
The same persisted chart payload supplies web and mobile; it is not regenerated
from prose on reload.

Per the plan's "for supported types it provides exact schema, examples,
analytical purpose, unsuitable uses, unit/scale requirements, limits,
interactions and platform support," every entry in `chartCatalog.presentations`
carries, beyond `types`/`purpose`/`status`: an `example` (a minimal payload for
that entry, each one checked by a test to actually pass `validateChatChart`,
so the catalog can never advertise an example that doesn't work) and
`unsuitable_for` (one sentence on when *not* to reach for it — the plan's
"unsuitable uses"). Interactions are documented once, globally, in the new
top-level `interactions` key (see Interactions below) rather than repeated
per entry, since they apply via the shared `INTERACTIVE_CHART_TYPES`/
`SORTABLE_CHART_TYPES` allowlists rather than varying per type. `deferred_types`
and `separate_renderer_families` name what's explicitly *not* available and
why, satisfying the plan's "must not suggest planned entries as executable
tools" — they're metadata, not enum members an agent could call. The whole
catalog (presentations + interactions + tool_schema) is kept under a 45KB
ceiling, with a per-entry cap of 900 bytes so no single addition can blow the
budget unnoticed — mirroring the equivalent size-cap test already enforced
on the document renderer catalog.

Initial types: bar, horizontal_bar, lollipop, dumbbell, stacked_bar,
stacked_bar_100, line, area, step_line, range_area, error_bar, stacked_area,
stacked_area_100, sparkline, pie, donut, rose, pareto, waterfall, funnel,
pyramid, waffle, scatter, bubble, scatter_trend, histogram, box_plot, density,
ecdf, strip_plot, beeswarm, scatter_matrix, correlation_matrix,
parallel_coordinates, radar, polar_bar, gauge, bullet, progress, heatmap,
calendar_heatmap, candlestick, drawdown, cumulative_return, gantt, treemap,
sunburst, tree, sankey, graph. The `_100`
variants normalize each category's series to percentages of what is present,
without treating an absent series as a zero contributor.
Sparklines reuse the line/area data shape with axes and legend hidden.
Lollipop is a single named series drawn as a thin stem and a dot. Dumbbell
compares exactly two named series per category (e.g. before vs after) as two
dots joined by a stem. Range_area needs a `low`/`high` bound per point instead
of a single `y`, for an uncertainty band or min/max range; error_bar uses the
same shape (plus an optional `value` when the drawn point is not the
low/high midpoint) for a single measurement's uncertainty whisker. Rose is
pie with each slice's radius (not just its angle) scaled by value. Pareto is
a single nonnegative series, ranked descending with a cumulative-percentage
line overlaid on a second axis. Waterfall is a single series of signed deltas
from the previous running total, not absolute values. Funnel/pyramid are a
single nonnegative name/value set rendered with ECharts' native funnel series,
sorted descending or ascending. Waffle allocates a nonnegative name/value set
across a 10x10 grid of unit squares by largest-remainder apportionment, so the
counts always sum to exactly 100. Bubble is scatter plus a nonnegative `size`
per point, drawn with diameter proportional to `sqrt(size)` so the area (what
the eye compares) scales with the value, not the radius. Scatter_trend is
scatter plus an ordinary-least-squares trend line fit to every point, pooled
across series; the line is simply omitted when every x is identical, since
the slope would be undefined, rather than drawn as a vertical or NaN line.

histogram, box_plot, density, ecdf, strip_plot and beeswarm take raw numeric
samples (`{name, values: number[]}`) instead of pre-aggregated points — the
renderer, not the caller, computes bins, a five-number summary, a density
curve or a cumulative share, so the same reproducible transform always
applies. Histogram is a single sample auto-binned into (by default) 10
equal-width bins. Box_plot computes a linear-interpolation five-number summary
per named sample. Density evaluates a Gaussian KDE (Silverman's rule-of-thumb
bandwidth) on a shared, padded grid. Ecdf is an exact step curve of cumulative
share from 0 to 1. Strip_plot places every raw point along one lane per named
sample with no jitter; beeswarm spreads colliding points sideways within
local density bins (same binning idea as histogram) so individual
observations stay visible.

scatter_matrix, correlation_matrix and parallel_coordinates also use the raw
`{name, values}` sample shape, but treat each named sample as one column of
an aligned table: every column needs the same number of rows (2-6 columns,
for legibility) rather than being independent samples. Scatter_matrix lays
out an n×n grid of small per-pair scatter cells (skipping the diagonal).
Correlation_matrix computes the exact pairwise Pearson coefficient for every
column pair and colors each cell on a blue–white–red diverging scale (the
diagonal is always exactly 1). Parallel_coordinates gives each column its own
axis and draws one line per row, using ECharts' native parallel coordinate
system.

radar and polar_bar reuse the ordinary `{name, points: {x, y}}` shape bar and
line already use: x is the indicator/category label, y the score. Radar
draws one closed shape per named series across a shared set of indicators (a
series missing an indicator counts as 0 there, since a radar shape needs a
value at every axis); polar_bar is the same category/value data as bar, laid
out on angle/radius axes instead of x/y, for cyclical categories like hours
of day or months of year.

gauge, bullet and progress take a flat `{name, value, min?, max?, target?,
bands?}` item per named target — never a series of points — with `min`/`max`
defaulting to 0/100 when absent. `value` (and `target`, when given) must fall
within `[min, max]`; `bands` are ascending thresholds within that range used
only by bullet. Gauge shows the value on a dial, with the target (if any)
spliced into the detail label as plain text (`"{value} / 80"`), not a
rendered marker on the dial itself. Bullet shows the value as a thin bar
over qualitative background bands plus a target tick, both scoped to that
bullet's own row via explicit axis bounds. Progress is a plain filled bar
against `max`, for a lightweight indicator rather than a dial.

heatmap is always a single series of independent `{x, y, value}` cells —
two categorical keys with no derived relationship between them (unlike
correlation_matrix, whose cells come from a computed statistic). Good for a
cohort/retention matrix: x = cohort, y = period, value = retention.
calendar_heatmap reuses the plain `{label, value}` or named-series shape
unchanged, but requires `label`/`x` to be an ISO `YYYY-MM-DD` date and is
limited to one named series (a calendar has one range; more would mean
silently dropping all but the first). Both color cells on a sequential
white-to-theme-color scale when every value is nonnegative, or the same
diverging blue-white-red scale correlation_matrix uses when any value is
negative — computed per cell, never via a registered visualMap.

candlestick takes a named OHLC series (`{x, open, high, low, close,
volume?}`); low/high must actually bound open/close or the bar would
misrepresent the traded range. A volume overlay (second y-axis, colored by
up/down day) appears automatically whenever any point includes `volume` —
it is not a separate chart_type. drawdown and cumulative_return need no new
data shape at all: both reuse the ordinary line/area `{name, points: {x,
y}}` shape and are purely a deterministic running computation over it in x
order. Drawdown's `y` is a price/equity level; its output is percentage
decline from the running peak (always ≤ 0). Cumulative_return's `y` is a
*periodic return* (0.02 for +2%), not a price level; its output is
compounded growth as a percentage.

gantt takes a flat `{name, low, high, group?}` row per task — never a
series of points, since a task has exactly one span. The axis is a plain
numeric timeline, not a calendar date axis; the caller picks the unit (e.g.
days since project start) and names it with `x_label`. A row with
`low === high` draws a diamond milestone marker instead of a bar, so a pure
chronological timeline of events is just every row being one — covering
Gantt, milestone, and interval/range bars, and plain timelines, as one type
rather than four. `group` optionally colors rows together and groups the
legend; up to 50 rows.

treemap, sunburst and tree take recursive `{name, value?, children?}` nodes
— a leaf (no `children`) needs its own `value` to be sized by; a branch's
`value` is optional, since ECharts sums its children. treemap/sunburst
happily lay out several top-level nodes side by side (up to 20); tree draws
one rooted layout, so it requires exactly one root. All three pass the
nodes straight through with no transform at all: ECharts' own data shape
for these series already matches ours exactly.

sankey and graph (node-link) take one combined `{nodes, links}` graph per
chart (not a per-category series) — `nodes[].id` identifies a node to
links, `name` (falling back to `id`) is both the ECharts node identity and
its displayed label, so two nodes resolving to the same effective name are
rejected (they would silently merge in the rendered graph). sankey requires
every link's `value` (it sizes the flow's ribbon width); graph does not —
link `value`, when given, only affects line width. graph uses a
force-directed layout with optional `category` per node for legend
grouping and coloring, and node size scaled by `sqrt(value)` so area (not
radius) is proportional, same convention as bubble.

A link's optional `type` (e.g. `"dependency"`, `"similarity"`) distinguishes
multiple relationship kinds between the same nodes: it gets a stable color
(the same `colorForName` hash used for series), plus a visible edge label
for graph (skipped for sankey, where a text label would clutter the flow
ribbons). `directed: true` draws an arrowhead and is graph-only — rejected
on sankey links, since sankey's source→target flow is already inherently
directed by the ribbon itself. Neither field changes how existing payloads
without them render.

marimekko, violin, icicle, circle_packing, chord, and alluvial-as-a-
separate-type are intentionally not included. A true variable-width mekko
chart needs ECharts' `custom` series with a `renderItem` function, which
this engine deliberately avoids everywhere else in favor of purely
declarative series (see the range_area/dumbbell/waterfall/error_bar/gantt
comments in `engine.ts`). Icicle and circle_packing have no native ECharts
series either, and the same `custom`-series concern applies to a faithful
implementation of either. Chord diagrams need curved ribbon widths
proportional to flow, which ECharts has no native series for; `graph`'s
circular layout is visually different and would misrepresent itself as a
chord diagram if offered under that name. Alluvial is the same underlying
visual as sankey (flow between stages over time), so it is covered by
`sankey` rather than added as a second type. Violin needs a density curve
mirrored sideways around each category's center, which would need stacking
along a value axis in an orientation this engine hasn't verified ECharts
actually supports declaratively — and unlike every other type here, that
assumption can't be checked by this test suite, since it only inspects the
resulting option object, never real rendering. Revisit any of these if a
concrete need comes up (and, for violin, a way to verify the rendering).

Themes: default, minimal, presentation, high_contrast. Appearance: auto,
light, dark. Use numeric x/y points for scatter. `auto` follows the device's
color-scheme setting; a host can supply an explicit appearance to match app
settings.

## Style, palette, accessibility and density

Per the plan's "appearance is independent of data semantics": a single
`theme` string must not also carry spacing and accessibility meaning, so
these are independent, optional top-level fields rather than more `theme`
values.

`density`: `compact` | `comfortable` (default) | `presentation`. Scales grid
padding and label/legend font size only — never which data is shown, and
never applied when absent, so every existing payload renders identically to
before this field existed.

`accessibility`: `{ high_contrast?, patterns?, reduced_motion?: boolean }`.
`high_contrast` selects the high_contrast palette without requiring
`theme: 'high_contrast'` specifically — it is read once, at the top of the
renderer, into the same `color` array every chart_type branch already reads
from, including the many that bake a color straight into a data point
(bubble, gauge, gantt, …) rather than relying on ECharts' own palette
cycling; a later post-processing pass over the built option could never
reach those. `patterns` turns on decal fill patterns (for color-vision
safety) independent of the palette. `reduced_motion` overrides the OS-level
`prefers-reduced-motion` signal in either direction; left unset, the OS
signal still applies as before.

Series-to-color assignment is stable by series *name* (a hash into the
palette), not by its position in the array — a series keeps its color if a
sibling is added, removed or reordered between renders, so "the Revenue
line is blue" stays true rather than shifting when the agent happens to
list series in a different order.

All twelve of the plan's visual styles are implemented, applied as a
single post-process over the already-built ECharts option (same place as
density) so every chart_type branch stays untouched when `visual_style` is
absent — the default, `'flat'`.

Three rewrite a series' own fill, and are restricted to
`FILL_SAFE_CHART_TYPES` — the twelve types sharing the one generic
bar/line/area/scatter construction path, where fill is purely decorative.
Requesting one elsewhere is rejected, not silently ignored:

- `'outlined'` — transparent fill, a colored border, zeroed area fill.
- `'glassmorphism'` — 0.55 opacity fill, a thin border, a soft shadow. Per
  the plan's "glass requires a readable opaque fallback" and "high
  contrast takes precedence over ornament," the whole transform is skipped
  under `accessibility.high_contrast` (or `theme: 'high_contrast'`) rather
  than fighting it field by field.
- `'skeuomorphism'` — the flat fill becomes a two-stop linear gradient
  (lighter top, darker bottom) plus a drop shadow: a gloss shading *on* the
  2D surface, not a fake 3D projection — the shape's extent on both axes
  never moves.

`FILL_SAFE_CHART_TYPES` is deliberately **not** offered to any of the
three for pie/donut/rose/funnel/pyramid/waffle (fill is the only thing
distinguishing adjacent slices), heatmap/calendar_heatmap/
correlation_matrix/treemap/sunburst (fill color *is* the data encoding),
or any type with its own helper/invisible sub-series (dumbbell,
range_area, error_bar, waterfall, gantt, bullet, ...), since none of these
fill-rewriting transforms were verified against those shapes.

The other nine (`'minimalism'`, `'material'`, `'neumorphism'`,
`'claymorphism'`, `'editorial'`, `'technical'`, `'hand_drawn'`,
`'brutalist'`, and `'flat'` itself) never touch a series' color or opacity
channel — only chrome, border, shadow and typography — so they apply to
every chart_type with no allowlist, the same way density does. Each simply
no-ops wherever the option shape it needs isn't present (e.g. `material`'s
shadow on a pie chart, which has no series-level `itemStyle` to begin
with):

- `'minimalism'` — hides axis split lines and ticks.
- `'material'` — a drop shadow and small border radius (card elevation).
- `'neumorphism'` — a soft shadow paired with a real border, never a
  shadow alone, per the plan's explicit accessibility caution that a
  boundary can't rely on shadow direction by itself.
- `'claymorphism'` — the same shadow-plus-border pairing as neumorphism,
  with a larger radius and a heavier border for a puffier look.
- `'editorial'` — a serif font family.
- `'technical'` — a monospace font family.
- `'hand_drawn'` — a casual/cursive font family plus a dashed border.
  There is no declarative sketch-line wobble: that needs ECharts' `custom`
  series with a `renderItem` function, deliberately avoided everywhere
  else in this engine, so positions never move — only the stroke style and
  the font approximate the feel.
- `'brutalist'` — a thick solid border (black, or white under
  `high_contrast`), zero corner radius, zero shadow.

## Interactions

Zoom/pan (scroll/pinch to zoom, drag to pan, double-click to reset) is
built into every chart_type in `INTERACTIVE_CHART_TYPES` — a plain-cartesian
single-axis-pair allowlist (excludes multi-grid, polar, calendar and
hierarchy/network layouts, where it either doesn't apply or ECharts gives a
different interaction model natively, e.g. `roam` on graph or click-to-zoom
on treemap/sunburst). Legend click-to-toggle-series is native ECharts
behavior on every multi-series chart; nothing is disabled. Both require no
payload field — there is nothing to request.

`sort: 'asc' | 'desc'` reorders by value for `SORTABLE_CHART_TYPES`: the
parts-of-a-whole family (pie/donut/rose/waffle; funnel/pyramid are
deliberately excluded, since ECharts' own `sort` on that series type
already always value-orders them for the narrowing shape) and
bar/horizontal_bar/lollipop when they are a single series — multi-series
bar is rejected rather than silently ignored, since "sort by which
series'value?" has no unambiguous answer.

`reference_lines: [{value, label?}]` (up to 10) draws a dashed line across
the value axis for `INTERACTIVE_CHART_TYPES` — a target, threshold or
baseline to compare the data against, attached as a `markLine` on the
chart's first series.

`visual_style` (all twelve values) is covered above, in "Style, palette,
accessibility and density".

`mountChatChart(...)` returns `svg()` (unchanged) and now `png()` —
rasterized via an `<img>`/`<canvas>` round-trip from the SVG, async since
image decoding is, rather than relying on ECharts' own `getDataURL` png
support, which targets the canvas renderer and this chart is mounted with
`renderer: 'svg'`.

Drill-down, cross-filtering and persisted selection state are intentionally
not part of this contract: they need a host-side data query or document
commit, which an agent cannot embed as executable code in a JSON payload —
per the plan's own "an interaction requiring a callback or data query is a
host capability, not executable code supplied by an agent." Bahulam's own
interaction runtime (drill-down/up, cross-filtering, filter clearing,
measure/hierarchy definitions, versioned Redis sessions) is being built for
this at the host level, separately from this portable contract. The
Generative BI *document* surface (`examples/generative-bi`,
`selectionMode: highlight | filter` in the ECharts document adapter) has
its own, different interaction model already — query-bound, tied to the
command gateway — which this read-only chat contract does not share.

A textual/table alternative is not yet implemented either: every one of
the ~10 data shapes in this contract (point/multi, interval, sample,
bubble, target, heatmap, OHLC, interval-item, hierarchy, graph) would need
its own table serialization, which is enough work to deserve its own pass
rather than folding in here.

## Package entry points

- `@bahulam/workplane-ui/chat`: headless TypeScript contract, validator and catalogue.
- `@bahulam/workplane-ui/chat/react`: React chart component (optional ECharts/React peers).
- `@bahulam/workplane-ui/chat/browser`: mount/dispose engine for offline WebViews.

The existing document/dashboard ECharts adapter remains available for data bindings
and normalized selection events. Chat charts are read-only presentations; they do
not yet expose linked filtering, document editing, or persisted user theme controls.

## Independent release workflow

From this repository:

```
pnpm install
pnpm export:chat ../bahulam-web ../codekepler-backend
```

This builds the package and exports:

1. A content-hashed tarball into `bahulam-web/vendor`, updating host dependency pins.
2. The JSON catalogue/schema into `codekepler-backend/app/chat/workplane-chart-v1.json`.
3. The bundled offline browser engine into the mobile rendering package.

Run `pnpm install` in the web repository and commit the package pins, lockfile,
contract and generated mobile asset together. Hashing the filename prevents stale
package-store reuse when testing unreleased package builds. No public npm release
or sibling checkout is needed in CI/deployment. A published package can replace the
vendored pin after a separately authorized release. Remove obsolete unreferenced
vendor archives when adopting a new version.

ECharts modules are bundled locally for mobile; no CDN or external connection is
needed. The WebView document uses a restrictive CSP and blocks external navigation.
Chart labels are data, not HTML or JavaScript. Web uses lazy loading and SVG output.

## Validation

`tests/contract/chat-chart.test.ts` covers advertised types, semantic options,
legacy payloads, invalid data and multi-series alignment. The backend consumes the
exported schema and adds semantic limits. Keep Python and TS contract fixtures in
agreement when adding types. Actual native iOS/Android WebView and packaged desktop
smoke tests are still required for a release, in addition to browser validation.


### Portable charts in Workplane documents

A `workplane.echarts` document block can use `{ presentation: payload }`, where
`payload` is the same validated `bahulam_render_v1` chart used in chat. All 50
core types reuse the chat engine, themes, data shapes, and saved JSON. The legacy
`option` and query `bind` format remains supported unchanged. Portable presentations
contain inline data; mixing them with legacy query bindings is rejected rather than
silently ignoring a binding. Agent discovery lists supported chart types; deferred
types and separate renderer families are advertised separately in the chat catalogue.
