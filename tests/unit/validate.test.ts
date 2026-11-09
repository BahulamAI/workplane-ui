import { describe, expect, it } from "vitest";
import { createDocument, validateDocument, withLimits, type WorkplaneDocument } from "@bahulam/workplane-ui";
import { createDemoDocument } from "@bahulam/workplane-ui/testkit";

const textBlock = (id: string) => ({
  id, kind: "content.text", title: id,
  rendererId: "workplane.text", specVersion: "1",
  spec: { text: "x" }, bindings: {}, dataRefs: [], fallback: id,
});

function base(): WorkplaneDocument {
  const doc = createDocument({ id: "doc", title: "Doc" });
  return {
    ...doc,
    sceneOrder: ["a"],
    scenes: { a: { id: "a", title: "A", layout: "flow", blockOrder: ["b1"], parameters: {} } },
    blocks: { b1: textBlock("b1") },
  };
}

function violations(doc: WorkplaneDocument) {
  const result = validateDocument(doc);
  return result.ok ? [] : result.violations.map((v) => v.message);
}

describe("structural invariants a JSON Schema pass would miss", () => {
  it("accepts a well-formed document", () => {
    expect(validateDocument(base()).ok).toBe(true);
    expect(validateDocument(createDemoDocument()).ok).toBe(true);
  });

  it("catches a block claimed by two scenes", () => {
    const doc = base();
    doc.sceneOrder = ["a", "b"];
    doc.scenes.b = { id: "b", title: "B", layout: "flow", blockOrder: ["b1"], parameters: {} };
    expect(violations(doc).join(" ")).toMatch(/claimed by 2 scenes/);
  });

  it("catches an orphaned block no scene lists", () => {
    const doc = base();
    doc.blocks.lost = textBlock("lost");
    expect(violations(doc).join(" ")).toMatch(/orphaned/);
  });

  it("catches a duplicate in sceneOrder", () => {
    const doc = base();
    doc.sceneOrder = ["a", "a"];
    expect(violations(doc).join(" ")).toMatch(/more than once in sceneOrder/);
  });

  it("catches an order entry pointing at nothing", () => {
    const doc = base();
    doc.sceneOrder = ["a", "ghost"];
    expect(violations(doc).join(" ")).toMatch(/unknown scene "ghost"/);
  });

  it("catches a scene missing from sceneOrder", () => {
    const doc = base();
    doc.scenes.hidden = { id: "hidden", title: "H", layout: "flow", blockOrder: [], parameters: {} };
    expect(violations(doc).join(" ")).toMatch(/not present in sceneOrder/);
  });

  it("catches a key that disagrees with the id it contains", () => {
    const doc = base();
    doc.blocks.b1 = { ...textBlock("b1"), id: "something_else" };
    expect(violations(doc).join(" ")).toMatch(/does not equal block id/);
  });

  it("catches a dataRef to a query that does not exist", () => {
    const doc = base();
    doc.blocks.b1 = { ...textBlock("b1"), dataRefs: ["nope"] };
    expect(violations(doc).join(" ")).toMatch(/unknown query "nope"/);
  });

  it("catches a query pointing at a missing data source", () => {
    const doc = base();
    doc.queries.q = { id: "q", dataSourceId: "gone", spec: {}, parameters: {} };
    expect(violations(doc).join(" ")).toMatch(/unknown data source "gone"/);
  });

  it("catches a binding path that is not a JSON Pointer", () => {
    const doc = base();
    doc.blocks.b1 = { ...textBlock("b1"), bindings: { v: { scope: "shared", path: "filters.period" } } };
    expect(violations(doc).join(" ")).toMatch(/must be a JSON Pointer/);
  });
});

describe("limits are enforced, never absent", () => {
  it("rejects a document over the block limit", () => {
    const doc = base();
    const limits = withLimits({ maxBlocks: 1 });
    doc.scenes.a = { ...doc.scenes.a!, blockOrder: ["b1", "b2"] };
    doc.blocks.b2 = textBlock("b2");
    const result = validateDocument(doc, limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => /limit is 1/.test(v.message))).toBe(true);
  });

  it("rejects a deeply nested spec — a decompression-bomb shape", () => {
    const doc = base();
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 40; i++) nested = { child: nested };
    doc.blocks.b1 = { ...textBlock("b1"), spec: nested as never };
    expect(violations(doc).join(" ")).toMatch(/nests \d+ deep/);
  });

  it("rejects an oversized spec", () => {
    const doc = base();
    doc.blocks.b1 = { ...textBlock("b1"), spec: { text: "x".repeat(200_000) } };
    expect(violations(doc).join(" ")).toMatch(/bytes, limit is/);
  });
});
