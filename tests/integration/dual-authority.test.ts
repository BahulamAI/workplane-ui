import { describe, expect, it } from "vitest";
import { LocalAuthority, PROTOCOL_VERSION, createDocument } from "@bahulam/workplane-ui";
import { PluginStateStorage } from "@bahulam/workplane-ui/bahulam";

/** A shared KV both writers hit, standing in for the plugin's SQLite table. */
function sharedKv() {
  const store = new Map<string, unknown>();
  const client = (plugin: string) => ({
    plugin,
    async getKey(key: string, fallback: unknown = null) { return store.has(key) ? store.get(key) : fallback; },
    async setKey(key: string, value: unknown) { store.set(key, value); },
    async state(op: string, args: Record<string, unknown>) {
      if (op === "delete") store.delete(String(args.key));
      return null;
    },
  });
  return { store, client };
}

const doc = () => createDocument({ id: "wp", title: "W", shared: { n: 0 } });
const policy = { writablePaths: [{ path: "/n", schema: { type: "integer" as const } }] };
const tx = (id: string, rev: number, value: number) => ({
  protocolVersion: PROTOCOL_VERSION, documentId: "wp", commandId: id, expectedRevision: rev,
  operations: [{ op: "state.set" as const, path: "/n", value }],
});
const actor = { id: "a", type: "user" as const, capabilities: [] };

describe("two authorities over one KV", () => {
  it("detects a concurrent write instead of silently overwriting it", async () => {
    const { store, client } = sharedKv();

    // The panel's authority.
    const viewStorage = new PluginStateStorage({ client: client("p") as never, seed: doc() });
    const view = new LocalAuthority({ storage: viewStorage, policy });

    // The host's authority, separate instance over the same KV.
    const hostStorage = new PluginStateStorage({ client: client("p") as never, seed: doc() });
    const host = new LocalAuthority({ storage: hostStorage, policy });

    // Panel reads, populating its cache.
    const before = await view.snapshot("wp");
    expect(before?.revision).toBe(0);

    // Agent commits through the host: revision 1, n = 42.
    const agent = await host.commit(tx("agent", 0, 42), actor);
    expect(agent.ok).toBe(true);
    expect((store.get("workplane_document") as { document: { shared: { n: number } } }).document.shared.n).toBe(42);

    // Now the panel commits, still holding its stale cache.
    const user = await view.commit(tx("user", 0, 7), actor);

    const final = store.get("workplane_document") as { document: { revision: number; shared: { n: number } } };
    console.log("  panel commit:", user.ok ? `accepted at revision ${user.revision}` : `rejected ${user.error.code}`);
    console.log("  stored revision:", final.document.revision, "| n =", final.document.shared.n);
    console.log("  agent's 42 survived:", final.document.shared.n === 42);

    // The panel must be told to rebase, not quietly win.
    expect(user.ok).toBe(false);
    if (!user.ok) {
      expect(user.error.code).toBe("CONFLICT");
      expect(user.error.detail?.currentRevision).toBe(1);
    }
    // And the agent's committed value must survive.
    expect(final.document.shared.n, "the agent's committed value was silently lost").toBe(42);
  });
});
