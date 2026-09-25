import { describe, expect, it } from "vitest";
import { describeKeyTree, sanitizeSpec, type KeyTree } from "@bahulam/workplane-ui";
import { echartsRenderer } from "@bahulam/workplane-ui/echarts";

const allow: KeyTree = {
  title: true,
  series: { $array: { type: true, data: { $array: true }, lineStyle: { type: true, color: true } } },
  nested: { deep: { deeper: true } },
};

const messages = (spec: unknown, tree: KeyTree = allow) => {
  const r = sanitizeSpec(spec, { allow: tree });
  return r.ok ? [] : r.violations.map((v) => `${v.path}: ${v.message}`);
};

describe("the envelope refuses what no renderer may receive", () => {
  it("rejects a URL anywhere in the spec", () => {
    for (const url of [
      "https://evil.example/x.png",
      "//evil.example/x.png",
      "image://https://evil.example/pin.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "javascript:alert(1)",
      "blob:https://x/y",
      "file:///etc/passwd",
    ]) {
      const out = messages({ title: url });
      expect(out.length, `${url} was accepted`).toBeGreaterThan(0);
      expect(out[0]).toMatch(/never fetches/);
    }
  });

  it("rejects executable-looking content", () => {
    for (const bad of ["<script>x()</script>", "onclick=doThing()", "function (v) { return v }", "v => { return v }"]) {
      expect(messages({ title: bad }).length, `${bad} was accepted`).toBeGreaterThan(0);
    }
  });

  it("allows an ordinary template string", () => {
    // ECharts formatters are string templates; refusing them would be useless.
    expect(messages({ title: "{b}: {c} INR" })).toEqual([]);
  });

  it("rejects prototype-poisoning keys", () => {
    expect(messages({ ["__proto__"]: { polluted: true } }).join(" ")).toMatch(/not permitted/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("neutralises non-finite numbers rather than passing them on", () => {
    // The spec is JSON round-tripped before validation, so NaN and Infinity
    // become null — safe, and gone before any renderer sees them.
    const result = sanitizeSpec({ series: [{ type: "line", data: [Number.NaN, Infinity, 1] }] }, { allow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = ((result.value as Record<string, unknown>).series as Record<string, unknown>[])[0]!.data;
    expect(data).toEqual([null, null, 1]);
  });

  it("enforces depth, array length, string length, and byte size", () => {
    // A free-form subtree, so depth is what fails rather than the allowlist.
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 40; i++) deep = { child: deep };
    expect(messages({ nested: deep }, { nested: true }).join(" ")).toMatch(/Nests deeper/);

    expect(
      sanitizeSpec({ series: [{ type: "line", data: Array.from({ length: 20 }, (_, i) => i) }] },
        { allow, limits: { maxDepth: 12, maxNodes: 9999, maxBytes: 99999, maxArrayLength: 5, maxStringLength: 100 } }),
    ).toMatchObject({ ok: false });

    expect(messages({ title: "x".repeat(99_999) }).join(" ")).toMatch(/exceeds|bytes/);
  });
});

describe("unknown keys are dropped, not rejected", () => {
  it("removes them and says which", () => {
    const result = sanitizeSpec({ title: "ok", mystery: 1, series: [{ type: "line", secret: 2 }] }, { allow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ title: "ok", series: [{ type: "line" }] });
    expect(result.dropped).toContain("/mystery");
    expect(result.dropped).toContain("/series/0/secret");
  });

  it("means a document written today survives an adapter that grows later", () => {
    const result = sanitizeSpec({ title: "ok", futureOption: { a: 1 } }, { allow });
    expect(result.ok).toBe(true);
  });

  it("describes the accepted shape for catalog discovery", () => {
    expect(describeKeyTree(allow)).toMatch(/title/);
    expect(describeKeyTree(allow)).toMatch(/series/);
  });
});

describe("the chart adapter speaks ECharts", () => {
  it("accepts multi-series with dashed lines and per-series colour — the chart that could not be drawn", () => {
    const outcome = echartsRenderer.validate({
      option: {
        xAxis: [{ type: "category", data: ["Jan", "Feb", "Mar"] }],
        yAxis: [{ type: "value" }],
        legend: { show: true },
        series: [
          { name: "Actual", type: "line", data: [1, 2, 3], lineStyle: { type: "solid", color: "#1f5fd6" } },
          { name: "Conservative", type: "line", data: [3, 4, 5], lineStyle: { type: "dashed", color: "#3fb950" } },
          { name: "Moderate", type: "line", data: [3, 5, 7], lineStyle: { type: "dotted", color: "#d29922" } },
          { name: "Aggressive", type: "line", data: [3, 6, 9], lineStyle: { type: "dashdot", color: "#f85149" } },
        ],
      },
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    if (!outcome.ok) return;
    expect((outcome.value.option.series as unknown[]).length).toBe(4);
  });

  it("refuses multi-series distinguished by colour alone", () => {
    const outcome = echartsRenderer.validate({
      option: {
        series: [
          { name: "A", type: "line", data: [1], lineStyle: { color: "#f00" } },
          { name: "B", type: "line", data: [2], lineStyle: { color: "#0f0" } },
        ],
      },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/WCAG/);
    expect(outcome.message).toMatch(/lineStyle.type/);
  });

  it("allows a single series with no pattern", () => {
    expect(echartsRenderer.validate({ option: { series: [{ type: "line", data: [1] }] } }).ok).toBe(true);
  });

  it("allows bars and stacks without a pattern, which are already distinguishable", () => {
    expect(echartsRenderer.validate({
      option: { series: [{ type: "bar", data: [1] }, { type: "bar", data: [2] }] },
    }).ok).toBe(true);
  });

  it("strips a formatter that tries to fetch", () => {
    const outcome = echartsRenderer.validate({
      option: {
        series: [{ type: "bar", data: [1] }],
        tooltip: { formatter: "() => fetch('https://evil.example')" },
      },
    });
    expect(outcome.ok).toBe(false);
  });

  it("drops an option key outside the allowlist rather than passing it to the engine", () => {
    const outcome = echartsRenderer.validate({
      option: { series: [{ type: "bar", data: [1] }], toolbox: { feature: { saveAsImage: {} } } },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.option.toolbox).toBeUndefined();
    expect(outcome.value.dropped).toContain("/toolbox");
  });

  it("binds query columns to series", () => {
    const outcome = echartsRenderer.validate({
      option: { xAxis: [{ type: "category" }], yAxis: [{ type: "value" }], series: [{ type: "bar" }] },
      bind: { queryId: "q", categoryColumn: "service", series: [{ index: 0, valueColumn: "cost", entityColumn: "serviceId" }] },
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.bind?.series[0]).toMatchObject({ index: 0, valueColumn: "cost" });
  });

  it("rejects a binding that points at a series which does not exist", () => {
    const outcome = echartsRenderer.validate({
      option: { series: [{ type: "bar" }] },
      bind: { queryId: "q", series: [{ index: 3, valueColumn: "cost" }] },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/must point at a series/);
  });

  it("still accepts the pre-envelope shape", () => {
    const outcome = echartsRenderer.validate({
      chartType: "bar", queryId: "cost_by_service",
      categoryColumn: "service", valueColumn: "cost", entityColumn: "serviceId",
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.bind?.queryId).toBe("cost_by_service");
    expect((outcome.value.option.series as Record<string, unknown>[])[0]?.type).toBe("bar");
  });

  it("refuses an unknown chart type instead of quietly drawing a bar", () => {
    const outcome = echartsRenderer.validate({
      chartType: "sunburst", queryId: "q", categoryColumn: "a", valueColumn: "b",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/send an ECharts option directly/);
  });
});

describe("the envelope accepts what the engine accepts", () => {
  it("takes a single object where the engine allows one, and normalises it", () => {
    // ECharts accepts xAxis as an object OR an array. Being stricter than the
    // engine means rejecting input that is correct for it.
    const outcome = echartsRenderer.validate({
      option: {
        xAxis: { type: "category", data: ["Jan", "Feb"] },
        yAxis: { type: "value" },
        series: { type: "line", data: [1, 2] },
      },
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    if (!outcome.ok) return;
    expect(Array.isArray(outcome.value.option.xAxis)).toBe(true);
    expect(Array.isArray(outcome.value.option.series)).toBe(true);
    expect((outcome.value.option.series as unknown[]).length).toBe(1);
  });

  it("still rejects a scalar where a list belongs", () => {
    const outcome = echartsRenderer.validate({ option: { series: "line" } });
    expect(outcome.ok).toBe(false);
  });

  it("tells the caller the accepted shape, not only the mistake", () => {
    const outcome = echartsRenderer.validate({ option: { series: [] } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message, "an error should carry the fix").toMatch(/Expected: \{ option:/);
    expect(outcome.message).toMatch(/lineStyle/);
  });

  it("points at the offending field", () => {
    const outcome = echartsRenderer.validate({
      option: { series: [{ type: "line", data: [1] }], tooltip: { formatter: "() => fetch('https://x')" } },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.path).toBe("/option/tooltip/formatter");
  });

  it("says how to fix an array mismatch it cannot normalise", () => {
    const r = sanitizeSpec({ items: { a: 1 } }, { allow: { items: { $array: true } } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.violations[0]!.message).toMatch(/wrap this object in \[ \]/);
  });
});
