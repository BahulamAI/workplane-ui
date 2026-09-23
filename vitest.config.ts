import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "packages/*/src/**/*.test.ts"],
    environment: "node",
    environmentMatchGlobs: [["tests/e2e/**", "jsdom"]],
    server: { deps: { inline: ["echarts"] } },
  },
  resolve: {
    alias: {
      "@bahulam/workplane-core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@bahulam/workplane-protocol": new URL("./packages/protocol/src/index.ts", import.meta.url).pathname,
      "@bahulam/workplane-data": new URL("./packages/data/src/index.ts", import.meta.url).pathname,
      "@bahulam/workplane-testkit": new URL("./packages/testkit/src/index.ts", import.meta.url).pathname,
      "@bahulam/workplane-react": new URL("./packages/react/src/index.ts", import.meta.url).pathname,
      "@bahulam/workplane-renderer-echarts": new URL("./packages/renderer-echarts/src/index.ts", import.meta.url).pathname,
    },
  },
});
