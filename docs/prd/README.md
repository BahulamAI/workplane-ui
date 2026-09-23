# Product requirements

This implementation follows **PRD-108 · Workplane: open, agent-native
interactive workspaces**, version 0.1 (originally issued as PRD-WP-001).

The PRD lives in Bahulam's internal PRD series, not in this repository. It
contains review limitations and source-audit notes that should be published
deliberately rather than by accident of a scaffold. Vendor the parts that
belong in public — the document contracts, the acceptance scenarios, the
renderer contract — as they stabilise.

The PRD carries an implementation-status section recording which acceptance
scenarios pass, which packages are real versus placeholders, and where this
implementation deviates from the document.

Where the implementation and the PRD disagree, or where the PRD leaves
something unresolved, it is recorded in [`../adr/README.md`](../adr/README.md)
rather than silently decided in code.
