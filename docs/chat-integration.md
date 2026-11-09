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

Initial types: bar, horizontal_bar, lollipop, dumbbell, stacked_bar,
stacked_bar_100, line, area, step_line, range_area, error_bar, stacked_area,
stacked_area_100, sparkline, pie, donut, rose, pareto, waterfall, funnel,
pyramid, waffle, scatter, bubble, scatter_trend, histogram, box_plot, density,
ecdf, strip_plot, beeswarm, scatter_matrix, correlation_matrix,
parallel_coordinates, radar, polar_bar, gauge, bullet, progress, heatmap,
calendar_heatmap, candlestick, drawdown, cumulative_return, gantt. The `_100`
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

marimekko and violin are intentionally not included. A true variable-width
mekko chart needs ECharts' `custom` series with a `renderItem` function,
which this engine deliberately avoids everywhere else in favor of purely
declarative series (see the range_area/dumbbell/waterfall/error_bar comments
in `engine.ts`). Violin needs a density curve mirrored sideways around each
category's center, which would need stacking along a value axis in an
orientation this engine hasn't verified ECharts actually supports
declaratively — and unlike every other type here, that assumption can't be
checked by this test suite, since it only inspects the resulting option
object, never real rendering. Revisit either if a concrete need comes up and
there's a way to verify the rendering.

Themes: default, minimal, presentation, high_contrast. Appearance: auto,
light, dark. Use numeric x/y points for scatter. `auto` follows the device's
color-scheme setting; a host can supply an explicit appearance to match app
settings.

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
