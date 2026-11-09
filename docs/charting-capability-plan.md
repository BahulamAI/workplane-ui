# Comprehensive charting and presentation coverage

Status: reviewed scope, not a claim that all listed capabilities are implemented.
Baseline: Workplane 0.1.1. The chat renderer supports nine types. The document
ECharts adapter registers bar, line and pie and exposes a different option schema.
Unifying those capabilities is part of this work; expanding just the chat enum
would leave the two surfaces inconsistent.

## Chart capability matrix

| Family | Existing chat capability | Missing coverage to design and implement |
| --- | --- | --- |
| Comparison/ranking | Bar, horizontal bar, stacked bar | Grouped and 100% stacked bars, lollipop, dot plot, dumbbell, slope, bump/rank, bullet, diverging bars |
| Trends/time series | Line, area, stacked area | Step, range/band, confidence intervals, sparklines, streamgraph, horizon, mixed bar/line with explicit units, small multiples |
| Contribution/change | Pie, donut | Pareto with cumulative percentage, waterfall including totals and negative crossings, funnel/pyramid, rose/polar bars, waffle, Marimekko |
| Distribution/statistics | Scatter | Histogram with declared binning, box plot, violin, density, ECDF, beeswarm, strip plots, error bars |
| Relationships | Scatter | Bubble with size semantics, regression/trend overlay, scatter matrix, correlation matrix, parallel coordinates |
| Matrix/calendar | None | Categorical heatmap, numeric heatmap, calendar heatmap, cohort/retention matrix |
| Multivariate profiles | None | Radar, polar, radial bars; require compatible/normalized units and explicit axis domains |
| Hierarchy | None | Treemap, sunburst, tree/dendrogram, icicle, circle packing |
| Flow/network | None in chat charts | Sankey, alluvial, node-link graph, chord, dependency networks; distinguish from Mermaid and the entity-graph tool |
| Financial | None | Candlestick/OHLC, volume overlays, drawdown, cumulative return; explicitly define ordering, currency and trading calendar |
| Targets/status | KPI tool exists separately | Gauge, bullet, progress/thermometer, target bands; merge discovery with KPI cards without pretending a card is a chart |
| Schedules/events | None | Timeline, Gantt, milestone, interval/range bars; explicit dates, zones and overlaps |
| Geography | None | Choropleth, proportional symbols, geographic heatmap, route/flow map; licensed/versioned geometry, projections and offline assets required |
| Scientific/specialist | Separate 3D renderer exists | Contour, surface, 3D scatter, ternary, vector/field views; renderer plugins, not indiscriminate additions to every mobile bundle |

A named pattern is not always a new engine series. Pareto composes bars and a
cumulative line; waterfall needs signed interval logic; a histogram needs a
reproducible binning transform. ECharts support alone does not establish Workplane
support: schema, registration, transformations, browser/native export and tests
must all be present.

## Appearance is independent of data semantics

Use separate settings, not one overloaded theme string:

- **Visual style:** default/flat, minimalism, skeuomorphism, glassmorphism,
  neumorphism, claymorphism, material/elevated, outlined/wireframe, editorial,
  technical/terminal, hand-drawn, and brutalist/geometric.
- **Appearance:** system, light, dark. Every style needs a fallback in each mode.
- **Density:** compact, comfortable, presentation. Controls labels, spacing and
  interaction targets without silently removing data.
- **Palette:** named or custom, categorical/sequential/diverging, semantic
  positive/negative/neutral/missing colors, stable series-to-color assignments.
- **Accessibility:** high contrast, color-vision-safe palettes, patterns, shapes,
  keyboard navigation, reduced motion/transparency, textual/table alternatives.
- **Typography/layout:** inherited host tokens, number/date formats, locale,
  mobile label treatment, print/export typography and background.

Styles change surfaces, borders, elevation, lighting and emphasis. They must not
create misleading pseudo-3D quantitative marks, diminish contrast or alter the
meaning of length, area or color. Glass requires a readable opaque fallback;
neumorphism cannot rely on shadows as the only boundary; hand-drawn styling must
preserve exact quantitative positions. High contrast takes precedence over
ornament. Palette type must fit the encoding, not merely look attractive.

Future default precedence: chart override > project preference > user preference
> organization default > library fallback. Resolve once and persist the resolved
presentation/version with an artifact so re-opening or sharing it does not change
its meaning because somebody changed their personal defaults. User-default
settings are not implemented in this baseline.

## Required data contracts

Retain simple and multi-series compatibility; add typed shapes rather than
forcing every chart into label/value pairs:

1. Categories and measures, ordered time series and missing-value semantics.
2. Numeric observations and declared transforms for bins/quantiles/density.
3. Matrix cells with independent x/y keys and value domains.
4. Intervals/ranges, uncertainty bands and OHLC tuples with ordering validation.
5. Hierarchical nodes with stable IDs, optional values and bounded depth.
6. Graph nodes/links with endpoint validation, weights and cycle rules per type.
7. Geographic keys/coordinates plus an approved, versioned geometry reference.
8. Domain/unit metadata, aggregation provenance, transformations and citations.

Validate equivalent semantics in the TypeScript renderer and backend. Reject
malformed or unsupported shapes explicitly. Missing values are not zero. Values
in sequential palettes share a scale; diverging scales specify a midpoint.
Palette input is bounded and data-only, never executable CSS or external URLs.

## Interaction and cross-platform requirements

Legend/filter toggles, zoom/pan/reset, brushing, linked selection, drill-down,
tooltips, annotation/reference lines, selection state, sorting, table fallback,
PNG/SVG/print export, responsive sizing, large-data aggregation, and empty/error
states belong in the capability matrix. An interaction requiring a callback or
data query is a host capability, not executable code supplied by an agent.

SVG/Canvas/WebView and desktop export have different constraints. Test Safari,
Chromium and Firefox, native WebViews, offline/CSP execution, resize/disposal,
reduced motion, light/dark and minimum mobile widths. Maps and specialist 3D
renderers must be loadable separately rather than bundled into every chart.

## Agent discovery and rollout acceptance

The catalogue must report **supported**, **experimental**, **planned**, or
**unavailable in this host**. For supported types it provides exact schema,
examples, analytical purpose, unsuitable uses, unit/scale requirements, limits,
interactions and platform support. The agent chooses from supported types based
on data and intent; it must not suggest planned entries as executable tools.

Roll out by complete data families, not arbitrary chart names:

1. Common contract, capability discovery, style/palette tokens and renderer parity.
2. Comparison/time/composition, matrix and target views.
3. Distributions, ranges, financial and schedule views.
4. Hierarchy, flow/network and multivariate views.
5. Geography and specialist renderer plugins.

A family is ready only after schema/semantic parity tests, deterministic
transformation tests, live rendering fixtures, accessible fallback, mobile and
export checks, documentation, and a fresh pinned host artifact. Publishing a
catalogue entry or enum alone does not count as implementation.
