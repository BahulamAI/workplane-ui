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
pyramid, waffle, scatter, histogram, box_plot, density, ecdf, strip_plot,
beeswarm. The `_100` variants normalize each category's series to percentages
of what is present, without treating an absent series as a zero contributor.
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
counts always sum to exactly 100.

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

marimekko is intentionally not included: a true variable-width mekko chart
needs ECharts' `custom` series with a `renderItem` function, which this
engine deliberately avoids everywhere else in favor of purely declarative
series (see the range_area/dumbbell/waterfall/error_bar comments in
`engine.ts`). Revisit if a concrete need for it comes up.

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
