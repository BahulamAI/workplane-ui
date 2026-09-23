# `adapter-bahulam` — placeholder

Bahulam host integration: `plugin.yaml` contribution parsing, Shared Blackboard
bridge, and legacy HTML panel coexistence.

**Not implemented.** Scheduled for M3.

Workplane is additive. When this lands, the invariants it must not break are:

1. Existing `plugin.yaml` bundles, `.mjs` tools, MCP tools, entry agents,
   subagents, Blackboard integrations, and HTML panels keep working.
2. A plugin may expose a legacy panel, a Workplane, both, or neither.
3. Plugin entry agents keep their conversational role. Workplane adds no
   mandatory platform-agent delegation layer.
4. Credentials stay behind the host credential broker, and never enter the
   document, agent context, exports, replay log, or telemetry.

Note the direction of the dependency: this package depends on public Workplane
contracts, and no core module depends back on Bahulam. `pnpm lint:boundaries`
enforces that.
