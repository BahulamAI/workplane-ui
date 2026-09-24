import { describe, expect, it } from "vitest";
import {
  applyOperation,
  applyOperations,
  createDocument,
  ReducerError,
  sceneIdOfBlock,
  type Operation,
  type WorkplaneDocument,
} from "@bahulam/workplane-ui";

const block = (id: string) => ({
  id,
  kind: "content.text",
  title: id,
  rendererId: "workplane.text",
  specVersion: "1",
  spec: { text: id },
});

function seed(): WorkplaneDocument {
  return applyOperations(createDocument({ id: "doc", title: "Doc" }), [
    { op: "scene.add", scene: { id: "a", title: "A" } },
    { op: "scene.add", scene: { id: "b", title: "B" } },
    { op: "block.add", sceneId: "a", block: block("b1") },
    { op: "block.add", sceneId: "a", block: block("b2") },
  ]);
}

describe("anchor semantics", () => {
  it("appends when the anchor field is omitted", () => {
    const next = applyOperation(seed(), { op: "scene.add", scene: { id: "c", title: "C" } }, "/0");
    expect(next.sceneOrder).toEqual(["a", "b", "c"]);
  });

  it("prepends on an explicit null, which is NOT the same as omitted", () => {
    const next = applyOperation(
      seed(),
      { op: "scene.add", scene: { id: "c", title: "C" }, afterSceneId: null },
      "/0",
    );
    expect(next.sceneOrder).toEqual(["c", "a", "b"]);
  });

  it("inserts after the named sibling", () => {
    const next = applyOperation(
      seed(),
      { op: "scene.add", scene: { id: "c", title: "C" }, afterSceneId: "a" },
      "/0",
    );
    expect(next.sceneOrder).toEqual(["a", "c", "b"]);
  });

  it("rejects a missing anchor instead of quietly appending", () => {
    expect(() =>
      applyOperation(
        seed(),
        { op: "scene.add", scene: { id: "c", title: "C" }, afterSceneId: "nope" },
        "/0",
      ),
    ).toThrow(ReducerError);
  });

  it("rejects a self-relative move", () => {
    expect(() =>
      applyOperation(seed(), { op: "scene.move", sceneId: "a", afterSceneId: "a" }, "/0"),
    ).toThrow(/relative to itself/);
  });
});

describe("membership", () => {
  it("moves a block between scenes without leaving it in both", () => {
    const next = applyOperation(
      seed(),
      { op: "block.move", blockId: "b1", sceneId: "b" },
      "/0",
    );
    expect(next.scenes.a?.blockOrder).toEqual(["b2"]);
    expect(next.scenes.b?.blockOrder).toEqual(["b1"]);
    expect(sceneIdOfBlock(next, "b1")).toBe("b");
  });

  it("removes a block from its owning scene's order", () => {
    const next = applyOperation(seed(), { op: "block.remove", blockId: "b1" }, "/0");
    expect(next.blocks.b1).toBeUndefined();
    expect(next.scenes.a?.blockOrder).toEqual(["b2"]);
  });

  it("refuses to remove a scene that still holds blocks", () => {
    expect(() => applyOperation(seed(), { op: "scene.remove", sceneId: "a" }, "/0")).toThrow(
      /still holds 2 blocks/,
    );
  });

  it("cascades only when explicitly asked", () => {
    const next = applyOperation(
      seed(),
      { op: "scene.remove", sceneId: "a", blocks: "cascade" },
      "/0",
    );
    expect(next.scenes.a).toBeUndefined();
    expect(next.blocks.b1).toBeUndefined();
    expect(next.blocks.b2).toBeUndefined();
  });

  it("rejects a duplicate block id", () => {
    expect(() =>
      applyOperation(seed(), { op: "block.add", sceneId: "b", block: block("b1") }, "/0"),
    ).toThrow(/already exists/);
  });
});

describe("state.set", () => {
  it("writes relative to shared, never the document root", () => {
    const next = applyOperation(
      createDocument({ id: "doc", title: "Doc", shared: { filters: { env: "dev" } } }),
      { op: "state.set", path: "/filters/env", value: "prod" },
      "/0",
    );
    expect(next.shared).toEqual({ filters: { env: "prod" } });
    // There is no operation that can reach /revision or /dataSources.
    expect(next.revision).toBe(0);
  });

  it("structurally shares untouched subtrees so bound renderers do not repaint", () => {
    const before = createDocument({
      id: "doc",
      title: "Doc",
      shared: { filters: { env: "dev" }, assumptions: { rate: 20 } },
    });
    const after = applyOperation(before, { op: "state.set", path: "/filters/env", value: "prod" }, "/0");
    expect(after.shared.assumptions).toBe(before.shared.assumptions);
    expect(after.shared.filters).not.toBe(before.shared.filters);
  });

  it("refuses to replace the whole shared object", () => {
    expect(() =>
      applyOperation(createDocument({ id: "doc", title: "Doc" }), { op: "state.set", path: "", value: 1 }, "/0"),
    ).toThrow(/within shared state/);
  });
});

describe("purity", () => {
  it("never mutates the input document", () => {
    const before = seed();
    const snapshot = JSON.stringify(before);
    applyOperations(before, [
      { op: "state.set", path: "/x", value: 1 },
      { op: "block.remove", blockId: "b1" },
      { op: "scene.move", sceneId: "b", afterSceneId: null },
    ] satisfies Operation[]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
