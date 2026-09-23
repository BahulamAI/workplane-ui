#!/usr/bin/env node
/**
 * Enforces the package dependency rules from PRD section 6.2.
 *
 * These are the rules that keep "headless" true. A single stray import is
 * enough to make the core un-embeddable, and it is invisible in review, so it
 * is checked mechanically instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RULES = [
  {
    package: "packages/core",
    banned: [
      ["react", /^react(\/|$)|^react-dom/],
      ["a chart engine", /^echarts|^vega|^plotly|^d3(\/|$)/],
      ["three.js", /^three(\/|$)|@react-three\//],
      ["a model SDK", /^openai$|@anthropic-ai\/|^ai$/],
      ["a Bahulam host package", /@bahulam\/(?!workplane-(protocol|data)\b)/],
      ["node builtins", /^node:|^fs$|^path$|^child_process$/],
      ["a database driver", /^pg$|^sqlite3?$|^mysql/],
    ],
  },
  {
    package: "packages/protocol",
    banned: [
      ["any dependency at all", /^[^.]/],
    ],
  },
  {
    package: "packages/data",
    banned: [
      ["react", /^react(\/|$)/],
      ["a chart engine", /^echarts|^vega|^plotly/],
      ["node builtins", /^node:|^fs$|^child_process$/],
    ],
  },
  {
    package: "packages/react",
    banned: [
      ["a mandatory chart engine", /^echarts|^vega|^plotly/],
      ["three.js", /^three(\/|$)|@react-three\//],
      ["a Bahulam package", /@bahulam\/(?!workplane-)/],
      ["node builtins", /^node:|^child_process$/],
    ],
  },
];

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
for (const rule of RULES) {
  let files;
  try {
    files = sourceFiles(join(rule.package, "src"));
  } catch {
    continue; // package not present yet
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const specifiers = [
      ...[...text.matchAll(IMPORT)].map((m) => m[1]),
      ...[...text.matchAll(DYNAMIC)].map((m) => m[1]),
    ];
    for (const specifier of specifiers) {
      for (const [label, pattern] of rule.banned) {
        if (pattern.test(specifier)) {
          console.error(`  ${file}\n    imports "${specifier}" — ${rule.package} must not depend on ${label}`);
          failures += 1;
        }
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nDependency rule check FAILED with ${failures} violation(s). See PRD section 6.2.`);
  process.exit(1);
}
console.log("Dependency rules (PRD 6.2): OK");
