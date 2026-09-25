import { sanitizeSpec, type KeyTree } from "../core/index.js";
import type { JsonValue } from "../protocol/index.js";
import type { RendererContract, ValidationOutcome } from "./contract.js";

/**
 * Contracts for the renderers that need no peer dependency.
 *
 * Headless: validation, summarisation and the advertised example live here, so
 * a host can publish the catalog without importing React. The components in
 * `../react/blocks` attach themselves to these.
 */

const STATIC = {
  interactive: false, selection: false, thumbnail: true,
  staticExport: true, suspend: false, requiresWebGL: false,
} as const;

const INTERACTIVE = {
  interactive: true, selection: false, thumbnail: false,
  staticExport: false, suspend: true, requiresWebGL: false,
} as const;

function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(spec: Record<string, JsonValue>, key: string): ValidationOutcome<string> {
  const value = spec[key];
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, message: `"${key}" must be a non-empty string`, path: `/${key}` };
  }
  return { ok: true, value };
}

/** Sanitize, then confirm the result is an object before reading fields off it. */
function envelope<T>(spec: unknown, allow: KeyTree, limits: Parameters<typeof sanitizeSpec>[1]["limits"]):
  | { ok: true; value: T }
  | { ok: false; message: string; path?: string } {
  const result = sanitizeSpec<T>(spec, { allow, ...(limits ? { limits } : {}) });
  if (!result.ok) {
    const first = result.violations[0]!;
    return { ok: false, message: first.message, path: first.path };
  }
  if (typeof result.value !== "object" || result.value === null || Array.isArray(result.value)) {
    return { ok: false, message: "Spec must be an object" };
  }
  return { ok: true, value: result.value };
}

// --- text and fact ----------------------------------------------------------

export interface TextSpec { text: string; generated?: boolean }

export const textContract: RendererContract<TextSpec> = {
  id: "workplane.text",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: STATIC,
  purpose: "A single plain paragraph. Prefer workplane.markdown unless the text is genuinely plain.",
  example: { text: "Costs are reported in the subscription's billing currency." },
  validate(spec) {
    if (!isObject(spec)) return { ok: false, message: "Spec must be an object" };
    if (typeof spec.text !== "string") {
      return { ok: false, message: '"text" must be a string', path: "/text" };
    }
    // Plain text only. There is no HTML path, so there is nothing to sanitize.
    return { ok: true, value: { text: spec.text, generated: spec.generated === true } };
  },
  summarize: (spec) => spec.text.slice(0, 200),
};

export interface FactSpec { template: string }

export const factContract: RendererContract<FactSpec> = {
  id: "workplane.fact",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: STATIC,
  purpose:
    "A sentence whose numbers come from live bindings, so it cannot drift out of agreement with the data.",
  example: { template: "Reducing {reductionPercent}% saves {savings}." },
  validate(spec) {
    if (!isObject(spec)) return { ok: false, message: "Spec must be an object" };
    if (typeof spec.template !== "string") {
      return { ok: false, message: '"template" must be a string', path: "/template" };
    }
    return { ok: true, value: { template: spec.template } };
  },
  summarize: (spec) => spec.template.slice(0, 200),
};

// --- metric -----------------------------------------------------------------

export type MetricSpec =
  | { source: "query"; queryId: string; column: string; unit?: string }
  | { source: "inline"; value: number; currency?: string; unit?: string };

export const metricContract: RendererContract<MetricSpec> = {
  id: "workplane.metric",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: STATIC,
  purpose:
    "One headline number, from a query or inline. Inline money is INTEGER MINOR UNITS: " +
    "1423.57 is sent as 142357.",
  example: { queryId: "total_spend", column: "total" },
  alternateExample: { value: 142357, currency: "USD" },
  validate(spec) {
    if (!isObject(spec)) return { ok: false, message: "Spec must be an object" };
    const unit = typeof spec.unit === "string" ? { unit: spec.unit } : {};

    if (spec.queryId === undefined && typeof spec.value === "number") {
      if (!Number.isFinite(spec.value)) {
        return { ok: false, message: '"value" must be finite', path: "/value" };
      }
      if (!Number.isInteger(spec.value)) {
        return {
          ok: false,
          message: '"value" must be integer minor units, not a decimal amount',
          path: "/value",
        };
      }
      return {
        ok: true,
        value: {
          source: "inline",
          value: spec.value,
          ...(typeof spec.currency === "string" ? { currency: spec.currency } : {}),
          ...unit,
        },
      };
    }

    const queryId = requireString(spec, "queryId");
    if (!queryId.ok) return queryId;
    const column = requireString(spec, "column");
    if (!column.ok) return column;
    return { ok: true, value: { source: "query", queryId: queryId.value, column: column.value, ...unit } };
  },
  summarize: (spec) =>
    spec.source === "inline" ? "metric (inline value)" : `metric ${spec.column} from ${spec.queryId}`,
};

// --- table ------------------------------------------------------------------

export type TableSpec =
  | { source: "query"; queryId: string; columns: string[]; pageSize: number }
  | {
      source: "inline"; columns: string[]; rows: JsonValue[][]; pageSize: number;
      moneyColumns?: string[]; currency?: string;
    };

export const tableContract: RendererContract<TableSpec> = {
  id: "workplane.table",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: { ...INTERACTIVE, staticExport: true },
  purpose:
    "Rows and columns, from a query or inline. Inline money columns are INTEGER MINOR UNITS " +
    "and must be named in moneyColumns.",
  example: { queryId: "cost_detail", columns: ["service", "cost"], pageSize: 12 },
  alternateExample: {
    columns: ["Service", "Cost"],
    rows: [["Container Apps", 5173448], ["Virtual Machines", 2013639]],
    moneyColumns: ["Cost"], currency: "INR", pageSize: 12,
  },
  validate(spec) {
    if (!isObject(spec)) return { ok: false, message: "Spec must be an object" };
    if (!Array.isArray(spec.columns) || !spec.columns.every((c) => typeof c === "string")) {
      return { ok: false, message: '"columns" must be an array of strings', path: "/columns" };
    }
    const columns = spec.columns as string[];
    const pageSize = typeof spec.pageSize === "number" ? spec.pageSize : 25;
    if (pageSize < 1 || pageSize > 500) {
      return { ok: false, message: '"pageSize" must be between 1 and 500', path: "/pageSize" };
    }

    if (spec.queryId === undefined && Array.isArray(spec.rows)) {
      const rows = spec.rows as JsonValue[][];
      if (!rows.every((row) => Array.isArray(row))) {
        return { ok: false, message: '"rows" must be an array of arrays', path: "/rows" };
      }
      if (rows.length > 5000) {
        return { ok: false, message: "Inline tables are limited to 5000 rows", path: "/rows" };
      }
      const money = Array.isArray(spec.moneyColumns)
        ? (spec.moneyColumns as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      return {
        ok: true,
        value: {
          source: "inline", columns, rows, pageSize,
          ...(money.length ? { moneyColumns: money } : {}),
          ...(typeof spec.currency === "string" ? { currency: spec.currency } : {}),
        },
      };
    }

    const queryId = requireString(spec, "queryId");
    if (!queryId.ok) return queryId;
    return { ok: true, value: { source: "query", queryId: queryId.value, columns, pageSize } };
  },
  summarize: (spec) =>
    spec.source === "inline"
      ? `table of ${spec.columns.join(", ")} (inline, ${spec.rows.length} rows)`
      : `table of ${spec.columns.join(", ")} from ${spec.queryId}`,
};

// --- form -------------------------------------------------------------------

export interface FormField {
  name: string; label: string;
  control: "text" | "number" | "select" | "checkbox";
  path: string;
  options?: Array<{ value: string; label: string }>;
  min?: number; max?: number; step?: number;
}
export interface FormSpec { fields: FormField[]; submitLabel: string }

const CONTROLS = new Set(["text", "number", "select", "checkbox"]);

function validateField(raw: unknown, index: number): { ok: false; message: string; path: string } | { ok: true; value: FormField } {
  if (!isObject(raw)) return { ok: false, message: "Field must be an object", path: `/fields/${index}` };
  for (const key of ["name", "label", "control", "path"]) {
    if (typeof raw[key] !== "string") {
      return { ok: false, message: `"${key}" must be a string`, path: `/fields/${index}/${key}` };
    }
  }
  if (!CONTROLS.has(raw.control as string)) {
    return { ok: false, message: `Unsupported control "${String(raw.control)}"`, path: `/fields/${index}/control` };
  }
  if (!(raw.path as string).startsWith("/")) {
    return { ok: false, message: "Field path must be a JSON Pointer", path: `/fields/${index}/path` };
  }
  const field: FormField = {
    name: raw.name as string, label: raw.label as string,
    control: raw.control as FormField["control"], path: raw.path as string,
  };
  if (Array.isArray(raw.options)) {
    field.options = raw.options.filter(isObject).map((o) => ({
      value: String(o.value), label: String(o.label ?? o.value),
    }));
  }
  for (const key of ["min", "max", "step"] as const) {
    if (typeof raw[key] === "number") field[key] = raw[key] as number;
  }
  return { ok: true, value: field };
}

export const formContract: RendererContract<FormSpec> = {
  id: "workplane.form",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: INTERACTIVE,
  purpose:
    "Typed inputs. Each field writes to a path the plugin declared writable; anything else is refused.",
  example: {
    fields: [
      { name: "days", label: "Look back (days)", control: "number", path: "/filters/days", min: 1, max: 365 },
    ],
    submitLabel: "Apply",
  },
  validate(spec) {
    if (!isObject(spec)) return { ok: false, message: "Spec must be an object" };
    if (!Array.isArray(spec.fields) || spec.fields.length === 0) {
      return { ok: false, message: '"fields" must be a non-empty array', path: "/fields" };
    }
    const fields: FormField[] = [];
    for (const [index, raw] of spec.fields.entries()) {
      const outcome = validateField(raw, index);
      if (!outcome.ok) return { ok: false, message: outcome.message, path: outcome.path };
      fields.push(outcome.value);
    }
    return {
      ok: true,
      value: { fields, submitLabel: typeof spec.submitLabel === "string" ? spec.submitLabel : "Apply" },
    };
  },
  summarize: (spec) => `form: ${spec.fields.map((f) => f.name).join(", ")}`,
};

// --- markdown, code, button -------------------------------------------------

export interface MarkdownSpec { markdown: string; generated?: boolean }

export const markdownContract: RendererContract<MarkdownSpec> = {
  id: "workplane.markdown",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: STATIC,
  purpose:
    "Prose with structure: headings, lists, tables, blockquotes, fenced code, emphasis. " +
    "The default choice for explanation.",
  example: {
    markdown:
      "## Load balancers\n\nA load balancer spreads requests across **several** servers.\n\n" +
      "- Round robin\n- Least connections\n\n| Strategy | Cost |\n|---|---|\n| Round robin | low |",
  },
  validate(spec) {
    // $verbatim: the source becomes React elements and every leaf a text node.
    // It never reaches innerHTML, so a URL or an arrow inside it is characters.
    const result = envelope<MarkdownSpec>(spec, { markdown: { $verbatim: true }, generated: true },
      { maxDepth: 4, maxNodes: 64, maxBytes: 128 * 1024, maxArrayLength: 8, maxStringLength: 64 * 1024 });
    if (!result.ok) return result;
    if (typeof result.value.markdown !== "string" || result.value.markdown.length === 0) {
      return { ok: false, message: '"markdown" must be a non-empty string', path: "/markdown" };
    }
    return result;
  },
  summarize: (spec) => spec.markdown.replace(/[#*`_>|-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
};

export interface CodeSpec { code: string; language?: string; caption?: string }

export const codeContract: RendererContract<CodeSpec> = {
  id: "workplane.code",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: { ...STATIC, thumbnail: false },
  purpose: "A code sample, displayed and never executed.",
  example: {
    code: "const region = process.env.AZURE_REGION;\nconsole.log(region);",
    language: "typescript",
    caption: "Reading the configured region",
  },
  validate(spec) {
    const result = envelope<CodeSpec>(spec, { code: { $verbatim: true }, language: true, caption: true },
      { maxDepth: 3, maxNodes: 32, maxBytes: 128 * 1024, maxArrayLength: 4, maxStringLength: 64 * 1024 });
    if (!result.ok) return result;
    if (typeof result.value.code !== "string" || result.value.code.length === 0) {
      return { ok: false, message: '"code" must be a non-empty string', path: "/code" };
    }
    if (result.value.language !== undefined && !/^[A-Za-z0-9+#._-]{1,24}$/.test(result.value.language)) {
      return { ok: false, message: '"language" must be a short identifier', path: "/language" };
    }
    return result;
  },
  summarize: (spec) => `${spec.language ?? "code"} sample, ${spec.code.split("\n").length} lines`,
};

export interface ButtonSpec {
  actionId: string; label: string;
  arguments?: Record<string, JsonValue>;
  confirm?: string;
  tone?: "default" | "primary" | "danger";
}

export const buttonContract: RendererContract<ButtonSpec> = {
  id: "workplane.button",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: { ...INTERACTIVE, suspend: false },
  purpose:
    "Requests a registered host action. Carries an action id and typed arguments — never a URL, " +
    "a command, or a tool name. Ids come from the plugin manifest.",
  example: { actionId: "check_answer", label: "Check my answer", arguments: { choice: "b" } },
  validate(spec) {
    const result = envelope<ButtonSpec>(spec,
      { actionId: true, label: true, arguments: true, confirm: true, tone: true },
      { maxDepth: 6, maxNodes: 200, maxBytes: 16 * 1024, maxArrayLength: 50, maxStringLength: 2048 });
    if (!result.ok) return result;
    const { actionId, label } = result.value;
    if (typeof actionId !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/i.test(actionId)) {
      return {
        ok: false,
        message:
          '"actionId" must be a registered action identifier such as "check_answer". ' +
          "A button cannot name a tool, a URL, or a command.",
        path: "/actionId",
      };
    }
    if (typeof label !== "string" || label.trim().length === 0) {
      return { ok: false, message: '"label" must say what the button does', path: "/label" };
    }
    return result;
  },
  summarize: (spec) => `button "${spec.label}" requesting ${spec.actionId}`,
};

export const NATIVE_CONTRACTS = [
  markdownContract, codeContract, textContract, factContract,
  metricContract, tableContract, formContract, buttonContract,
] as const;
