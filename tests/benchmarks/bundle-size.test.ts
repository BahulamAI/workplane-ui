import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PRD section 20 states bundle budgets as acceptance targets, and section 7.2
 * requires them to be independently measurable. A target nobody measures is a
 * wish, so it is measured here and fails the build when exceeded.
 *
 * Workplane ships as one package with several entry points, so the budgets are
 * measured per layer inside `dist` — which is exactly what a consumer's bundler
 * pulls when it imports a given entry.
 */
const DIST = "packages/workplane-ui/dist";
const KB = 1024;

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

function gzippedBytes(...layers: string[]): number {
  let total = 0;
  for (const layer of layers) {
    for (const file of files(join(DIST, layer))) {
      if (file.endsWith(".js")) total += gzipSync(readFileSync(file)).length;
    }
  }
  return total;
}

describe("bundle budgets (PRD section 20)", () => {
  it("the headless layers stay under 100 KB gzip combined", () => {
    // "Headless package: at most 100 KB gzip including required runtime
    // dependencies; measured separately from React and renderers."
    // `renderers` is part of the headless entry: `src/index.ts` exports it so a
    // host can publish the catalog without React. Measuring without it would
    // understate what a consumer of "." actually pulls.
    expect(gzippedBytes("protocol", "core", "data", "renderers")).toBeLessThan(100 * KB);
  });

  it("the React reference shell stays under 250 KB gzip", () => {
    // "Reference shell: at most 250 KB gzip incremental application JS
    // excluding React and optional engines." React is an optional peer, so it
    // is not in this output at all.
    expect(gzippedBytes("react")).toBeLessThan(250 * KB);
  });

  it("the chart adapter is separable from the default graph", () => {
    expect(gzippedBytes("renderer-echarts")).toBeLessThan(50 * KB);
  });

  it("the 3D adapter is separable too", () => {
    // Our code only. `three` itself is an optional peer and never in this
    // output, which is the whole reason it has its own entry point: a document
    // with no 3D block must not pay 150 KB for the possibility of one.
    expect(gzippedBytes("renderer-three")).toBeLessThan(50 * KB);
  });
});

describe("the headless entry really is headless", () => {
  /**
   * This is the property that one-package packaging could silently break: a
   * consumer importing `@bahulam/workplane-ui` must not pull React or a chart
   * engine into their bundle. The directory boundaries are enforced in source
   * by `pnpm lint:boundaries`; this checks the SHIPPED output too, because that
   * is what a bundler actually reads.
   */
  const headless = ["protocol", "core", "data", "renderers"].flatMap((layer) => files(join(DIST, layer)));

  it("ships JavaScript and declarations for every headless layer", () => {
    expect(headless.some((f) => f.endsWith(".js"))).toBe(true);
    expect(headless.some((f) => f.endsWith(".d.ts"))).toBe(true);
  });

  it("imports no React, chart engine, or Node builtin", () => {
    const offenders: string[] = [];
    for (const file of headless.filter((f) => f.endsWith(".js"))) {
      const text = readFileSync(file, "utf8");
      for (const [label, pattern] of [
        ["react", /from\s*["']react(\/|["'])/],
        ["a chart engine", /from\s*["'](echarts|vega|plotly|d3)/],
        ["three.js", /from\s*["']three(\/|["'])/],
        ["a node builtin", /from\s*["']node:/],
      ] as const) {
        if (pattern.test(text)) offenders.push(`${file} imports ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the package declares React and echarts as OPTIONAL peers", () => {
    // A required peer would make a headless install noisy and, on npm 7+,
    // actually pull React into a server-side consumer's tree.
    const manifest = JSON.parse(
      readFileSync("packages/workplane-ui/package.json", "utf8"),
    ) as { peerDependenciesMeta?: Record<string, { optional?: boolean }> };
    for (const peer of ["react", "react-dom", "echarts", "mermaid", "three"]) {
      expect(manifest.peerDependenciesMeta?.[peer]?.optional).toBe(true);
    }
  });
});
