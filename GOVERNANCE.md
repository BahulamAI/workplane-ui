# Governance

## Current model

Workplane is sponsored by Bahulam and maintained by a small maintainer group.
This is a benevolent-maintainer model, stated plainly rather than dressed up as
a foundation. It is expected to change as outside contribution grows.

## Roles

**Contributor** — anyone who opens an issue or pull request.

**Maintainer** — merge rights on one or more areas. Added by consensus of
existing maintainers after sustained, high-quality contribution.

**Area owner** — accountable for a domain. Approval of an architectural change
requires the relevant area owners. The PRD requires named owners for:

| Area | Owner |
|---|---|
| Core / authority | _unassigned_ |
| React UX | _unassigned_ |
| Bahulam integration | _unassigned_ |
| Data semantics | _unassigned_ |
| Security | _unassigned_ |

These are unassigned as of this scaffold. They are a release gate, not a
formality: M1 is not approved until they are filled.

## Decisions

Routine changes: maintainer review and merge.

Architectural changes — public API, document schema, command semantics,
security boundary, or a new mandatory dependency — require an ADR in
`docs/adr/`, conformance fixtures, and area-owner approval. Lazy consensus over
5 working days; an unresolved objection escalates to the sponsor.

We do not hide an unresolved decision behind an "already supported" claim. If
something is proposed, the documentation says proposed.

## Releases

Semantic versioning per package, with schema and protocol versions tracked
separately — package `0.3.0` does not imply document schema `3`. Every release
declares compatible schema versions, renderer profiles, browser and React
support, and migration paths.

CI inspects packed tarballs so a missing stylesheet, schema file, or type
declaration cannot be hidden by local workspace linking.

## Support

Core bugs are supported. Community adapters are not, and the issue tracker
labels the difference. See [SUPPORT.md](SUPPORT.md).

## Telemetry

Off by default in the standalone library, and opt-in through an interface in a
host. The project does not collect customer data, prompts, document text, or
credentials.
