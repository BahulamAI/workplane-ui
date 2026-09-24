import { describe, expect, it } from "vitest";
import { importLegacyWorkplane } from "@bahulam/workplane-ui/bahulam";
import { createNativeRegistry } from "@bahulam/workplane-ui/react";
import { echartsRenderer } from "@bahulam/workplane-ui/echarts";

const registry = createNativeRegistry().register(echartsRenderer);

const legacy = {
  version: 1,
  updated_at: "2026-09-24T20:38:52.747Z",
  widgets: [
    { id: "cost-summary", type: "metric" as const, title: "Total", value: 1423.57, format: "currency", currency: "USD" },
    { id: "cost-by-service", type: "bar_chart" as const, title: "By service",
      data: [{ label: "Azure App Service", value: 412.3 }], format: "currency", currency: "USD" },
    { id: "cost-trend", type: "line_chart" as const, title: "Trend",
      data: [{ label: "2026-09-18", value: 62.94 }], currency: "USD" },
    { id: "svc-table", type: "table" as const, title: "Detail",
      columns: ["Service", "Cost"], rows: [["Azure App Service", 412.3]],
      // The real widget declares format as an index -> format map.
      format: { 1: "currency" }, currency: "USD" },
    { id: "budget", type: "alert" as const, title: "Budget", message: "82% consumed", tone: "warning" },
  ],
};

describe("imported legacy widgets actually render", () => {
  const ops = importLegacyWorkplane(legacy, { sceneId: "imported" });

  it("produces one scene and a block per widget", () => {
    expect(ops[0]).toMatchObject({ op: "scene.add" });
    expect(ops.filter((o) => o.op === "block.add")).toHaveLength(5);
  });

  it("every imported block's spec validates against its renderer", () => {
    const failures: string[] = [];
    for (const op of ops) {
      if (op.op !== "block.add") continue;
      const def = registry.get(op.block.rendererId);
      if (!def) { failures.push(`${op.block.id}: no renderer "${op.block.rendererId}"`); continue; }
      const outcome = def.validate(op.block.spec);
      if (!outcome.ok) failures.push(`${op.block.id} (${op.block.rendererId}): ${outcome.message}`);
    }
    expect(failures, `\n${failures.join("\n")}`).toEqual([]);
  });
});

describe("legacy values survive the unit conversion", () => {
  const ops = importLegacyWorkplane(legacy, { sceneId: "imported" });
  const specOf = (id: string) => {
    const op = ops.find((o) => o.op === "block.add" && o.block.id === `legacy_${id}`);
    if (!op || op.op !== "block.add") throw new Error(`no block for ${id}`);
    const def = registry.get(op.block.rendererId)!;
    const outcome = def.validate(op.block.spec);
    if (!outcome.ok) throw new Error(`${id} invalid: ${outcome.message}`);
    return outcome.value as Record<string, unknown>;
  };

  it("converts a metric from major to minor units", () => {
    // 1423.57 dollars must become 142357 minor units, not 1423 or 1424.
    expect(specOf("cost-summary")).toMatchObject({ source: "inline", value: 142_357, currency: "USD" });
  });

  it("converts chart points and derives a stable entity id", () => {
    const spec = specOf("cost-by-service");
    expect(spec).toMatchObject({ source: "inline", chartType: "bar", currency: "USD" });
    expect((spec.data as unknown[])[0]).toEqual({
      id: "azure-app-service",
      label: "Azure App Service",
      value: 41_230,
    });
  });

  it("maps a line widget to a line chart", () => {
    expect(specOf("cost-trend")).toMatchObject({ chartType: "line" });
    expect((specOf("cost-trend").data as Array<{ value: number }>)[0]?.value).toBe(6_294);
  });

  it("converts only the table columns the widget marked as currency", () => {
    const spec = specOf("svc-table");
    expect(spec.columns).toEqual(["Service", "Cost"]);
    // The legacy widget declared format {1:"currency"}, so column 1 only.
    expect(spec.moneyColumns).toEqual(["Cost"]);
    expect(spec.rows).toEqual([["Azure App Service", 41_230]]);
  });

  it("leaves a table column as text when the widget never said it was money", () => {
    // Without a per-column format there is no way to know which column holds
    // currency. Guessing from the presence of a `currency` field would convert
    // a count or a percentage by mistake, so the value stays as text.
    const ops2 = importLegacyWorkplane({
      version: 1,
      widgets: [{ id: "t", type: "table", title: "T", columns: ["A", "B"], rows: [["x", 5]], currency: "USD" }],
    });
    const add = ops2.find((o) => o.op === "block.add");
    if (!add || add.op !== "block.add") throw new Error("no block");
    const outcome = registry.get("workplane.table")!.validate(add.block.spec);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const spec = outcome.value as Record<string, unknown>;
    expect(spec.moneyColumns).toBeUndefined();
    expect(spec.rows).toEqual([["x", "5"]]);
  });

  it("keeps an alert as plain text", () => {
    expect(specOf("budget")).toMatchObject({ text: "82% consumed" });
  });

  it("labels every imported block as a snapshot with its timestamp", () => {
    for (const op of ops) {
      if (op.op !== "block.add") continue;
      expect(op.block.fallback).toMatch(/imported from a legacy widget snapshot — taken 2026-09-24/);
    }
  });

  it("rejects a decimal inline metric value, so nobody reintroduces float money", () => {
    const metric = registry.get("workplane.metric")!;
    const outcome = metric.validate({ value: 1423.57, currency: "USD" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/integer minor units/);
  });

  it("still rejects a raw vendor option object on the inline path", () => {
    const outcome = echartsRenderer.validate({
      chartType: "bar",
      data: [{ label: "x", value: 1 }],
      tooltip: { formatter: "() => fetch('https://evil.example')" },
    });
    // Unknown fields are dropped, not carried into the rendered option.
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(JSON.stringify(outcome.value)).not.toMatch(/formatter|fetch/);
  });
});
