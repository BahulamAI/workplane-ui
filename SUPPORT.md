# Support

## Where to ask

| You have | Go to |
|---|---|
| A question about using Workplane | GitHub Discussions |
| A reproducible bug in a first-party package | GitHub Issues, label `core` or the package name |
| A problem with a community adapter | That adapter's own repository |
| A security vulnerability | [SECURITY.md](SECURITY.md) — not a public issue |

## What "supported" means here

Bugs in `packages/*` are supported by the maintainers. Packages under
`experimental/` are placeholders with no code and no support. Community
adapters are supported by their authors; we will help route an issue but cannot
fix someone else's renderer.

Pre-1.0, expect breaking changes between minor versions. Each release notes them
with a migration path.

## Before filing a bug

Run the no-key demo (`pnpm dev`) and say whether it reproduces there. A report
against the synthetic fixture is far faster to act on than one that needs your
cloud account. Include package versions, document schema version, browser, and
the correlation ID from the error if you have one.
