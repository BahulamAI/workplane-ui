# `vanilla-wrapper` — placeholder

Not written yet. The working example is [`../generative-bi`](../generative-bi),
which covers the M1 acceptance loop end to end.

This one carries extra weight: it is the **test** of the claim that the core is
framework-independent. Until something non-React drives the same
`WorkplaneController`, "headless" is an assertion rather than a verified
property. `packages/core` exposes `subscribe()` / `getState()` precisely so this
example can exist without React.
