import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PRD section 20 states bundle budgets as acceptance targets. A target nobody
 * measures is a wish, so it is measured here and fails the build when exceeded.
 *
 * Measured on the built `dist` output, excluding type declarations and source
 * maps — what a consumer's bundler would actually pull in.
 */
function gzippedBytes(packageDir: string): number {
  const dist = join("packages", packageDir, "dist");
  let total = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".js")) {
        total += gzipSync(readFileSync(full)).length;
      }
    }
  };
  walk(dist);
  return total;
}

const KB = 1024;

describe("bundle budgets (PRD section 20)", () => {
  it("the headless packages stay under 100 KB gzip combined", () => {
    // "Headless package: at most 100 KB gzip including required runtime
    // dependencies; measured separately from React and renderers."
    const total = ["protocol", "core", "data"].reduce((sum, pkg) => sum + gzippedBytes(pkg), 0);
    expect(total).toBeLessThan(100 * KB);
  });

  it("the React reference shell stays under 250 KB gzip", () => {
    // "Reference shell: at most 250 KB gzip incremental application JS
    // excluding React and optional engines." React and ECharts are peer
    // dependencies, so neither is in this package's own output.
    expect(gzippedBytes("react")).toBeLessThan(250 * KB);
  });

  it("the chart adapter is separable from the default graph", () => {
    // The adapter must not be so large that shipping it is effectively
    // mandatory; ECharts itself is a peer dependency and not measured here.
    expect(gzippedBytes("renderer-echarts")).toBeLessThan(50 * KB);
  });
});
