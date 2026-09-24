import { defineConfig } from "vitest/config";

const entry = (name: string) =>
  new URL(`./packages/workplane-ui/src/${name}`, import.meta.url).pathname;

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    environmentMatchGlobs: [["tests/e2e/**", "jsdom"]],
    server: { deps: { inline: ["echarts"] } },
  },
  resolve: {
    // Tests import the PUBLIC entry points, so they exercise what ships.
    alias: [
      { find: "@bahulam/workplane-ui/styles.css", replacement: entry("react/styles.css") },
      { find: "@bahulam/workplane-ui/echarts", replacement: entry("echarts.ts") },
      { find: "@bahulam/workplane-ui/bahulam", replacement: entry("bahulam.ts") },
      { find: "@bahulam/workplane-ui/testkit", replacement: entry("testkit.ts") },
      { find: "@bahulam/workplane-ui/react", replacement: entry("react.ts") },
      { find: "@bahulam/workplane-ui", replacement: entry("index.ts") },
    ],
  },
});
