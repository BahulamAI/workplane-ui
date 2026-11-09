import { describe, expect, it } from "vitest";
import {
  applyOperations,
  createDocument,
  diffDocuments,
  documentAt,
  restoreOperations,
  shouldCheckpoint,
  type Checkpoint,
  type CommittedEvent,
  type Operation,
  type WorkplaneDocument,
} from "@bahulam/workplane-ui";

const block = (id: string, title = id) => ({
  id, kind: "content.text", title, rendererId: "workplane.text",
  specVersion: "1", spec: { text: title },
});

function build(operations: Operation[][], seed?: WorkplaneDocument) {
  let document = seed ?? createDocument({ id: "wp", title: "W", shared: { filters: { env: "dev" } } });
  const events: CommittedEvent[] = [];
  operations.forEach((ops, index) => {
    document = { ...applyOperations(document, ops), revision: index + 1 };
    events.push({
      documentId: "wp", revision: index + 1, commandId: `c${index}`, operations: ops,
      actor: { id: "u", type: "user" }, committedAt: `2026-09-25T00:00:0${index}.000Z`,
      commitId: `wpc_${index + 1}`, parentId: index === 0 ? null : `wpc_${index}`,
    });
  });
  return { document, events };
}

/** Build a document, delete a scene, and keep the checkpoint at revision 0. */
function withDeletedScene() {
  const seed = createDocument({ id: "wp", title: "W", shared: { filters: { env: "dev" } } });
  const { document, events } = build([
    [
      { op: "scene.add", scene: { id: "keep", title: "Keep" } },
      { op: "scene.add", scene: { id: "doomed", title: "Doomed" } },
      { op: "block.add", sceneId: "doomed", block: block("b1", "First") },
      { op: "block.add", sceneId: "doomed", block: block("b2", "Second") },
      { op: "block.add", sceneId: "keep", block: block("k1") },
    ],
    // An agent (or a person) deletes the scene and everything in it.
    [{ op: "scene.remove", sceneId: "doomed", blocks: "cascade" }],
  ], seed);
  return { seed, document, events };
}

describe("reconstructing a past revision", () => {
  it("rebuilds the revision before a scene was deleted", () => {
    const { seed, document, events } = withDeletedScene();
    expect(document.sceneOrder).toEqual(["keep"]);
    expect(document.blocks.b1).toBeUndefined();

    const checkpoints: Checkpoint[] = [{ revision: 0, document: seed }];
    const before = documentAt(1, checkpoints, events);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.document.sceneOrder).toEqual(["keep", "doomed"]);
    expect(before.document.scenes.doomed?.blockOrder).toEqual(["b1", "b2"]);
    expect(before.document.blocks.b1?.title).toBe("First");
  });

  it("returns the checkpoint itself when it matches", () => {
    const { seed } = withDeletedScene();
    const result = documentAt(0, [{ revision: 0, document: seed }], []);
    expect(result.ok).toBe(true);
  });

  it("refuses rather than guessing when history was compacted past the target", () => {
    const { document, events } = withDeletedScene();
    // Only a late checkpoint survives; revision 1 is unreachable.
    const result = documentAt(1, [{ revision: 2, document }], events);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-checkpoint");
    expect(result.earliestReachable).toBe(2);
    expect(result.message).toMatch(/compacted/);
  });

  it("refuses when an event in the replay range is missing", () => {
    const { seed, events } = withDeletedScene();
    const result = documentAt(2, [{ revision: 0, document: seed }], [events[1]!]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-events");
  });

  it("checkpoints at the first revision and then periodically", () => {
    expect(shouldCheckpoint(1)).toBe(true);
    expect(shouldCheckpoint(25)).toBe(true);
    expect(shouldCheckpoint(7)).toBe(false);
  });
});

describe("diff", () => {
  it("reports a deleted scene and its blocks", () => {
    const { seed, document, events } = withDeletedScene();
    const before = documentAt(1, [{ revision: 0, document: seed }], events);
    if (!before.ok) throw new Error("unreachable");

    const diff = diffDocuments(before.document, document);
    expect(diff.scenes.removed).toEqual(["doomed"]);
    expect(diff.blocks.removed.sort()).toEqual(["b1", "b2"]);
    expect(diff.empty).toBe(false);
  });

  it("reports nothing for identical documents", () => {
    const { document } = withDeletedScene();
    expect(diffDocuments(document, document).empty).toBe(true);
  });

  it("reports shared changes as JSON Pointers", () => {
    const a = createDocument({ id: "wp", title: "W", shared: { filters: { env: "dev" } } });
    const b = { ...a, shared: { filters: { env: "prod" } } };
    expect(diffDocuments(a, b).shared).toEqual([
      { path: "/filters/env", from: "dev", to: "prod" },
    ]);
  });
});

describe("restoring a deleted scene", () => {
  it("brings the scene, its blocks, and their order back", () => {
    const { seed, document, events } = withDeletedScene();
    const target = documentAt(1, [{ revision: 0, document: seed }], events);
    if (!target.ok) throw new Error("unreachable");

    const plan = restoreOperations(document, target.document);
    const restored = applyOperations(document, [...plan.structural, ...plan.shared]);

    expect(restored.sceneOrder).toEqual(["keep", "doomed"]);
    expect(restored.scenes.doomed?.blockOrder).toEqual(["b1", "b2"]);
    expect(restored.blocks.b1?.title).toBe("First");
    expect(restored.blocks.b2?.title).toBe("Second");
  });

  it("round-trips: applying the plan reproduces the target exactly", () => {
    const { seed, document, events } = withDeletedScene();
    const target = documentAt(1, [{ revision: 0, document: seed }], events);
    if (!target.ok) throw new Error("unreachable");

    const plan = restoreOperations(document, target.document);
    const restored = applyOperations(document, [...plan.structural, ...plan.shared]);
    expect(diffDocuments(restored, target.document).empty).toBe(true);
  });

  it("round-trips across a mixed set of changes", () => {
    const seed = createDocument({ id: "wp", title: "W", shared: { a: 1, nested: { x: "one" } } });
    const { document: v1 } = build([[
      { op: "scene.add", scene: { id: "s1", title: "One" } },
      { op: "scene.add", scene: { id: "s2", title: "Two" } },
      { op: "block.add", sceneId: "s1", block: block("a") },
      { op: "block.add", sceneId: "s1", block: block("b") },
      { op: "block.add", sceneId: "s2", block: block("c") },
    ]], seed);

    // Then: delete a scene, move a block, retitle, reorder, change state.
    const v2 = applyOperations(v1, [
      { op: "block.move", blockId: "c", sceneId: "s1", afterBlockId: null },
      { op: "scene.remove", sceneId: "s2", blocks: "cascade" },
      { op: "scene.update", sceneId: "s1", patch: { title: "Renamed" } },
      { op: "block.update", blockId: "a", patch: { title: "Changed", spec: { text: "new" } } },
      { op: "state.set", path: "/nested/x", value: "two" },
    ]);

    const plan = restoreOperations(v2, v1);
    const restored = applyOperations(v2, [...plan.structural, ...plan.shared]);
    const diff = diffDocuments(restored, v1);
    expect(diff, `not restored:\n${JSON.stringify(diff, null, 1)}`).toMatchObject({ empty: true });
  });

  it("separates shared changes, which policy may refuse", () => {
    const a = createDocument({ id: "wp", title: "W", shared: { n: 1 } });
    const b = { ...a, shared: { n: 2 } };
    const plan = restoreOperations(b, a);
    expect(plan.structural.every((op) => op.op !== "state.set")).toBe(true);
    expect(plan.shared).toEqual([{ op: "state.set", path: "/n", value: 1 }]);
    expect(plan.warnings.join(" ")).toMatch(/no longer writable by policy/);
  });

  it("warns rather than silently reinterpreting a changed renderer", () => {
    const base = createDocument({ id: "wp", title: "W" });
    const v1 = applyOperations(base, [
      { op: "scene.add", scene: { id: "s", title: "S" } },
      { op: "block.add", sceneId: "s", block: block("x") },
    ]);
    const v2 = applyOperations(v1, [
      { op: "block.remove", blockId: "x" },
      { op: "block.add", sceneId: "s", block: { ...block("x"), rendererId: "workplane.metric" } },
    ]);
    const plan = restoreOperations(v2, v1);
    expect(plan.warnings.join(" ")).toMatch(/Its renderer is not restored/);
  });

  it("says plainly that a restore cannot undo external effects", async () => {
    const { seed, document, events } = withDeletedScene();
    const target = documentAt(1, [{ revision: 0, document: seed }], events);
    if (!target.ok) throw new Error("unreachable");
    const { describeRestore } = await import("@bahulam/workplane-ui");
    const lines = describeRestore(restoreOperations(document, target.document), diffDocuments(document, target.document));
    expect(lines.join(" ")).toMatch(/NEW revision/);
    expect(lines.join(" ")).toMatch(/cannot undo anything that happened outside the document/);
  });
});

describe("restore round-trips across every mutation the operation set allows", () => {
  const base = () => {
    const seed = createDocument({
      id: "wp", title: "W",
      shared: { a: 1, nested: { x: "one", y: true }, list: ["p", "q"] },
    });
    return applyOperations(seed, [
      { op: "scene.add", scene: { id: "s1", title: "One", layout: "flow" } },
      { op: "scene.add", scene: { id: "s2", title: "Two", layout: "grid" } },
      { op: "scene.add", scene: { id: "s3", title: "Three" } },
      { op: "block.add", sceneId: "s1", block: block("a") },
      { op: "block.add", sceneId: "s1", block: block("b") },
      { op: "block.add", sceneId: "s2", block: block("c") },
      { op: "block.add", sceneId: "s3", block: block("d") },
    ]);
  };

  const cases: Array<[string, Operation[]]> = [
    ["a scene deleted", [{ op: "scene.remove", sceneId: "s3", blocks: "cascade" }]],
    ["two scenes deleted", [
      { op: "scene.remove", sceneId: "s2", blocks: "cascade" },
      { op: "scene.remove", sceneId: "s3", blocks: "cascade" },
    ]],
    ["scenes reordered", [
      { op: "scene.move", sceneId: "s3", afterSceneId: null },
      { op: "scene.move", sceneId: "s1", afterSceneId: "s2" },
    ]],
    ["blocks reordered within a scene", [{ op: "block.move", blockId: "b", sceneId: "s1", afterBlockId: null }]],
    ["a block moved between scenes", [{ op: "block.move", blockId: "a", sceneId: "s2" }]],
    ["a block moved then its old scene deleted", [
      { op: "block.move", blockId: "d", sceneId: "s1" },
      { op: "scene.remove", sceneId: "s3" },
    ]],
    ["a block removed", [{ op: "block.remove", blockId: "c" }]],
    ["a block added", [{ op: "block.add", sceneId: "s2", block: block("new") }]],
    ["a block retitled and respecified", [
      { op: "block.update", blockId: "a", patch: { title: "Changed", spec: { text: "different" } } },
    ]],
    ["a scene retitled and relaid out", [
      { op: "scene.update", sceneId: "s1", patch: { title: "Renamed", layout: "grid" } },
    ]],
    ["scene parameters changed", [
      { op: "scene.update", sceneId: "s2", patch: { parameters: { frozen: true } } },
    ]],
    ["nested shared state changed", [{ op: "state.set", path: "/nested/x", value: "two" }]],
    ["a shared array replaced", [{ op: "state.set", path: "/list", value: ["r"] }]],
    ["everything at once", [
      { op: "block.move", blockId: "d", sceneId: "s1", afterBlockId: null },
      { op: "scene.remove", sceneId: "s3", blocks: "cascade" },
      { op: "scene.update", sceneId: "s1", patch: { title: "Renamed", layout: "grid" } },
      { op: "block.update", blockId: "b", patch: { title: "Edited" } },
      { op: "block.add", sceneId: "s2", block: block("extra") },
      { op: "block.remove", blockId: "c" },
      { op: "scene.move", sceneId: "s2", afterSceneId: null },
      { op: "state.set", path: "/nested/y", value: false },
    ]],
  ];

  it.each(cases)("restores after: %s", (_name, mutation) => {
    const original = base();
    const mutated = applyOperations(original, mutation);

    const plan = restoreOperations(mutated, original);
    const restored = applyOperations(mutated, [...plan.structural, ...plan.shared]);

    const diff = diffDocuments(restored, original);
    expect(diff, `not restored:\n${JSON.stringify(diff, null, 1)}`).toMatchObject({ empty: true });
    // Order is part of the document, and diffDocuments only reports relative
    // order, so assert it exactly.
    expect(restored.sceneOrder).toEqual(original.sceneOrder);
    for (const sceneId of original.sceneOrder) {
      expect(restored.scenes[sceneId]?.blockOrder).toEqual(original.scenes[sceneId]?.blockOrder);
    }
  });

  it("is a no-op when nothing changed", () => {
    const document = base();
    const plan = restoreOperations(document, document);
    const restored = applyOperations(document, [...plan.structural, ...plan.shared]);
    expect(diffDocuments(restored, document).empty).toBe(true);
    expect(plan.shared).toHaveLength(0);
  });
});
