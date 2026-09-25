#!/usr/bin/env node
/**
 * Enforces the package dependency rules from PRD section 6.2.
 *
 * Workplane ships as ONE npm package, but the architectural boundaries inside
 * it are real and load-bearing: the headless core must stay free of React, a
 * chart engine, a model SDK, Node builtins, and any Bahulam host package. That
 * is what makes it embeddable in a server, a CLI, or a non-React host.
 *
 * Since the boundaries are now directories rather than published packages,
 * nothing but this check stops a stray import from quietly erasing them — a
 * single line is invisible in review and would not fail the build otherwise.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = "packages/workplane-ui/src";

/** Directories under src/, in dependency order. Earlier may not import later. */
const LAYERS = ["protocol", "data", "core", "renderers", "react", "renderer-echarts", "adapter-bahulam", "testkit"];

const EXTERNAL_RULES = {
  protocol: [["any external dependency", /^[^./]/]],
  data: [
    ["react", /^react(\/|$)|^react-dom/],
    ["a chart engine", /^echarts|^vega|^plotly|^d3(\/|$)/],
    ["node builtins", /^node:|^fs$|^path$|^child_process$/],
  ],
  core: [
    ["react", /^react(\/|$)|^react-dom/],
    ["a chart engine", /^echarts|^vega|^plotly|^d3(\/|$)/],
    ["three.js", /^three(\/|$)|@react-three\//],
    ["a model SDK", /^openai$|@anthropic-ai\/|^ai$/],
    ["a Bahulam host package", /@bahulam\//],
    ["node builtins", /^node:|^fs$|^path$|^child_process$/],
    ["a database driver", /^pg$|^sqlite3?$|^mysql/],
  ],
  // Renderer contracts are the catalog: a host must be able to publish them
  // without loading React or a chart engine, which is the whole reason they are
  // separate from the components.
  renderers: [
    ["react", /^react(\/|$)|^react-dom/],
    ["a chart engine", /^echarts|^vega|^plotly|^d3(\/|$)/],
    ["three.js", /^three(\/|$)|@react-three\//],
    ["mermaid", /^mermaid(\/|$)/],
    ["a Bahulam host package", /@bahulam\//],
    ["node builtins", /^node:|^fs$|^path$|^child_process$/],
  ],
  react: [
    ["a mandatory chart engine", /^echarts|^vega|^plotly/],
    ["three.js", /^three(\/|$)|@react-three\//],
    ["a Bahulam host package", /@bahulam\//],
    ["node builtins", /^node:|^child_process$/],
  ],
  "adapter-bahulam": [
    ["react", /^react(\/|$)|^react-dom/],
    ["a chart engine", /^echarts|^vega|^plotly/],
    ["node builtins", /^node:|^child_process$/],
  ],
};

/** Which sibling directories each layer may import. */
const ALLOWED_INTERNAL = {
  protocol: [],
  data: ["protocol"],
  core: ["protocol", "data"],
  renderers: ["protocol", "core", "data"],
  react: ["protocol", "core", "data", "renderers"],
  "renderer-echarts": ["protocol", "core", "data", "renderers", "react"],
  "adapter-bahulam": ["protocol", "core", "data"],
  testkit: ["protocol", "core", "data", "renderers"],
};

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
const DYNAMIC = /import\(\s*["']([^"']+)["']\)/g;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

let failures = 0;
const fail = (file, message) => {
  console.error(`  ${file}\n    ${message}`);
  failures += 1;
};

for (const layer of LAYERS) {
  let files;
  try {
    files = sourceFiles(join(SRC, layer));
  } catch {
    continue;
  }

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const specifiers = [
      ...[...text.matchAll(IMPORT)].map((m) => m[1]),
      ...[...text.matchAll(DYNAMIC)].map((m) => m[1]),
    ];

    for (const specifier of specifiers) {
      // External specifier: check the banned list for this layer.
      if (!specifier.startsWith(".")) {
        for (const [label, pattern] of EXTERNAL_RULES[layer] ?? []) {
          if (pattern.test(specifier)) {
            fail(file, `imports "${specifier}" — ${layer} must not depend on ${label}`);
          }
        }
        continue;
      }

      // Relative specifier: which layer does it land in?
      const target = relative(resolve(SRC), resolve(file, "..", specifier)).split("/")[0];
      if (target === layer || target === "" || target.startsWith("..")) continue;
      if (!LAYERS.includes(target)) continue;

      const allowed = ALLOWED_INTERNAL[layer] ?? [];
      if (!allowed.includes(target)) {
        fail(
          file,
          `imports "${specifier}" — ${layer} may not reach into ${target} (allowed: ${allowed.join(", ") || "nothing"})`,
        );
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nDependency rule check FAILED with ${failures} violation(s). See PRD section 6.2.`);
  process.exit(1);
}
console.log("Dependency rules (PRD 6.2): OK");
