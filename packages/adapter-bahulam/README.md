# `@bahulam/workplane-adapter-bahulam`

Bahulam host adapter. Lets a Workplane run inside a Bahulam plugin view using
the local service's existing HTTP surface.

## What it binds to

Everything here talks to endpoints the CLI already exposes — no runtime changes
were needed for the storage and data paths:

| Module | Host surface | Workplane contract |
|---|---|---|
| `BahulamClient` | `/api/plugin-state`, `/api/tools/execute`, `/api/events` | — |
| `PluginStateStorage` | `POST /api/plugin-state/<plugin>` | `StoragePort` |
| `HttpCommandGateway` | `POST /api/workplane/<plugin>/commands` | `CommandGateway` |
| `PluginToolDataProvider` | `POST /api/tools/execute` | `DataProvider` |
| `importLegacyWorkplane` | the existing `workplane` KV key | one-way import |

## Two authority modes, one contract

`PluginStateStorage` + `LocalAuthority` puts the authority in the browser. It
needs nothing from the host beyond the blackboard, and it is honest about its
limit: one writer, one tab — the embedded-local mode in PRD section 6.3.

`HttpCommandGateway` puts the authority in the host process, which is a real
single writer across tabs with real optimistic concurrency — the local-service
mode, and the recommended Bahulam path.

Both must pass `runGatewayConformance` from `@bahulam/workplane-testkit`. That
suite is the point: if a transport can change the meaning of a command, it
fails, and the claim that transport is replaceable stops being a claim.

## Credentials

There is no call in this package that can read plugin config. The local service
refuses `getConfig` and the `_config` key to browser views, so a Workplane
document cannot acquire a credential even by mistake. Tools read their own
secrets inside the host process; this adapter sends parameters and receives
rows.

## Legacy coexistence

`importLegacyWorkplane` reads the existing widget list into blocks **one way**.
It never writes back, so the legacy panel and a Workplane view cannot fight
over one value, and the legacy `workplane` key is not touched — a Workplane
document lives under `workplane_document`.

Imported blocks carry literal values, not query references, because legacy
widgets have no query to re-run. Their fallback text says so rather than
implying a freshness the data does not have. A `three_scene` widget imports as
an unsupported-renderer block: the 3D renderer is an M5 package, and showing a
labelled fallback is better than dropping the content or faking it with a bar
chart.
