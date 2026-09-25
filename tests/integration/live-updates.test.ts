import { describe, expect, it } from "vitest";
import type { CommittedEvent, WorkplaneDocument } from "@bahulam/workplane-ui";
import { HttpCommandGateway } from "@bahulam/workplane-ui/bahulam";

/** Minimal stand-in for the host: a document, a log, and a bus. */
function fakeHost(plugin = "p") {
  let revision = 0;
  const events: CommittedEvent[] = [];
  const listeners: Array<(name: string, data: unknown) => void> = [];

  const document = (): WorkplaneDocument => ({
    schemaVersion: "workplane/1", id: "wp", revision, title: "W",
    sceneOrder: [], scenes: {}, blocks: {}, shared: {},
    dataSources: {}, queries: {}, artifacts: {},
  });

  const calls = { snapshot: 0, events: 0 };

  /** Something else (an agent) commits, then the bus fires. */
  const externalCommit = (target = "workplane:wp") => {
    revision += 1;
    events.push({
      documentId: "wp", revision, commandId: `agent_${revision}`, operations: [],
      actor: { id: "agent", type: "agent" }, committedAt: new Date().toISOString(),
      commitId: `wpc_${revision}`, parentId: revision > 1 ? `wpc_${revision - 1}` : null,
    });
    for (const l of listeners) l("plugin_state_changed", { plugin, target });
  };

  /** A write that has nothing to do with Workplane. */
  const unrelatedWrite = () => {
    for (const l of listeners) l("plugin_state_changed", { plugin, target: "dashboard_data" });
  };

  const client = {
    plugin,
    async get(path: string) {
      if (path.includes("/events")) {
        calls.events += 1;
        const after = Number(new URL(path, "http://x").searchParams.get("after") ?? 0);
        return { events: events.filter((e) => e.revision > after) };
      }
      calls.snapshot += 1;
      return { document: document(), documentId: "wp" };
    },
    async post() {
      revision += 1;
      const event: CommittedEvent = {
        documentId: "wp", revision, commandId: `panel_${revision}`, operations: [],
        actor: { id: "panel", type: "user" }, committedAt: new Date().toISOString(),
        commitId: `wpc_${revision}`, parentId: revision > 1 ? `wpc_${revision - 1}` : null,
      };
      events.push(event);
      return { ok: true, revision, document: document(), event, replayed: false };
    },
    subscribeEvents(onEvent: (name: string, data: unknown) => void) {
      listeners.push(onEvent);
      return () => listeners.splice(listeners.indexOf(onEvent), 1);
    },
  };

  return { client, externalCommit, unrelatedWrite, calls, current: () => revision };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("live updates from the host bus", () => {
  it("delivers an agent's commit without a reload", async () => {
    const host = fakeHost();
    const gateway = new HttpCommandGateway(host.client as never);
    await gateway.snapshot("wp");

    const seen: number[] = [];
    gateway.subscribe((event) => seen.push(event.revision));

    host.externalCommit();
    await settle();
    expect(seen).toEqual([1]);
  });

  it("does not replay history from the beginning", async () => {
    const host = fakeHost();
    // Three commits happen BEFORE this client ever connects.
    host.externalCommit(); host.externalCommit(); host.externalCommit();

    const gateway = new HttpCommandGateway(host.client as never);
    await gateway.snapshot("wp");
    const seen: number[] = [];
    gateway.subscribe((event) => seen.push(event.revision));

    host.externalCommit();
    await settle();
    expect(seen, "only the commit made after connecting should arrive").toEqual([4]);
  });

  it("does not deliver the panel's own commit twice", async () => {
    const host = fakeHost();
    const gateway = new HttpCommandGateway(host.client as never);
    await gateway.snapshot("wp");
    const seen: number[] = [];
    gateway.subscribe((event) => seen.push(event.revision));

    await gateway.commit(
      { protocolVersion: "workplane/1", documentId: "wp", commandId: "c1", expectedRevision: 0, operations: [] },
      { id: "u", type: "user", capabilities: [] },
    );
    // The host bus fires for that same write.
    host.unrelatedWrite();
    for (const l of [0]) void l;
    await settle();

    expect(seen, "the local echo must not be followed by a duplicate").toEqual([1]);
  });

  it("ignores writes that are not Workplane writes", async () => {
    const host = fakeHost();
    const gateway = new HttpCommandGateway(host.client as never);
    await gateway.snapshot("wp");
    gateway.subscribe(() => {});
    const before = host.calls.snapshot;

    host.unrelatedWrite();
    host.unrelatedWrite();
    await settle();

    expect(host.calls.snapshot, "an unrelated state write should cost no round trip").toBe(before);
  });

  it("coalesces a burst into one round trip", async () => {
    const host = fakeHost();
    const gateway = new HttpCommandGateway(host.client as never);
    await gateway.snapshot("wp");
    const seen: number[] = [];
    gateway.subscribe((event) => seen.push(event.revision));
    const before = host.calls.snapshot;

    // Several commits land before the first resync completes.
    host.externalCommit();
    host.externalCommit();
    host.externalCommit();
    await settle();

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen).size, "no revision delivered twice").toBe(seen.length);
    expect(host.calls.snapshot - before, "a burst must not cost one round trip each").toBeLessThan(3);
  });

  it("stops listening when the last subscriber leaves", async () => {
    const host = fakeHost();
    const gateway = new HttpCommandGateway(host.client as never);
    await gateway.snapshot("wp");
    const seen: number[] = [];
    const off = gateway.subscribe((event) => seen.push(event.revision));

    host.externalCommit();
    await settle();
    const delivered = seen.length;

    off();
    host.externalCommit();
    await settle();
    expect(seen.length, "an unsubscribed listener still received events").toBe(delivered);
  });
});
