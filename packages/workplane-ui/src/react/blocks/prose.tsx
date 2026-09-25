import type { ReactNode } from "react";
import { sanitizeSpec, type KeyTree } from "../../core/index.js";
import type { JsonValue } from "../../protocol/index.js";
import type { RendererDefinition } from "../registry.js";
import { parseMarkdown, type Inline, type MarkdownNode } from "./markdown.js";

// --- markdown ---------------------------------------------------------------

interface MarkdownSpec {
  markdown: string;
  /** Generated prose is labelled so a reader can tell it from a bound fact. */
  generated?: boolean;
}

const MARKDOWN_ALLOW: KeyTree = {
  // $verbatim: the source is parsed into React elements and every leaf becomes
  // a text node. It never reaches innerHTML, so a URL or a `=>` inside it is
  // just characters — and lesson prose needs both.
  markdown: { $verbatim: true },
  generated: true,
};

function renderInline(nodes: Inline[], keyPrefix = ""): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.kind) {
      case "text":
        return <span key={key}>{node.text}</span>;
      case "code":
        return <code key={key} data-workplane="inline-code">{node.text}</code>;
      case "strong":
        return <strong key={key}>{renderInline(node.children, `${key}-`)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, `${key}-`)}</em>;
      case "link": {
        // Rendered as an anchor only for http(s). Anything else — javascript:,
        // data:, a bare scheme — shows as text with the target visible, so a
        // generated document cannot turn a label into an unexpected action.
        const safe = /^https?:\/\//i.test(node.href);
        return safe ? (
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.children, `${key}-`)}
          </a>
        ) : (
          <span key={key} data-workplane="unsafe-link">
            {renderInline(node.children, `${key}-`)} ({node.href})
          </span>
        );
      }
    }
  });
}

function renderBlocks(nodes: MarkdownNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    const key = String(index);
    switch (node.kind) {
      case "heading": {
        const Tag = `h${node.level}` as "h1";
        return <Tag key={key}>{renderInline(node.children, `${key}-`)}</Tag>;
      }
      case "paragraph":
        return <p key={key}>{renderInline(node.children, `${key}-`)}</p>;
      case "list":
        return node.ordered ? (
          <ol key={key}>{node.items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}-`)}</li>)}</ol>
        ) : (
          <ul key={key}>{node.items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}-`)}</li>)}</ul>
        );
      case "code":
        return (
          <pre key={key} data-workplane="code" data-language={node.language ?? undefined}>
            <code>{node.text}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={key}>{renderInline(node.children, `${key}-`)}</blockquote>;
      case "rule":
        return <hr key={key} />;
      case "table":
        return (
          <div key={key} data-workplane="table-scroll">
            <table>
              <thead>
                <tr>{node.head.map((cell, i) => <th key={i} scope="col">{renderInline(cell, `${key}-h${i}-`)}</th>)}</tr>
              </thead>
              <tbody>
                {node.rows.map((row, r) => (
                  <tr key={r}>{row.map((cell, c) => <td key={c}>{renderInline(cell, `${key}-${r}-${c}-`)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export const markdownRenderer: RendererDefinition<MarkdownSpec> = {
  id: "workplane.markdown",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: false, selection: false, thumbnail: true,
    staticExport: true, suspend: false, requiresWebGL: false,
  },
  validate(spec: unknown) {
    const result = sanitizeSpec<MarkdownSpec>(spec, {
      allow: MARKDOWN_ALLOW,
      limits: { maxDepth: 4, maxNodes: 64, maxBytes: 128 * 1024, maxArrayLength: 8, maxStringLength: 64 * 1024 },
    });
    if (!result.ok) {
      const first = result.violations[0]!;
      return { ok: false as const, message: first.message, path: first.path };
    }
    // A scalar or null spec sanitizes to itself, so confirm it is an object
    // before reading a field off it.
    if (typeof result.value !== "object" || result.value === null || Array.isArray(result.value)) {
      return { ok: false as const, message: "Spec must be an object" };
    }
    if (typeof result.value.markdown !== "string" || result.value.markdown.length === 0) {
      return { ok: false as const, message: '"markdown" must be a non-empty string', path: "/markdown" };
    }
    return { ok: true as const, value: result.value };
  },
  summarize: (spec) => spec.markdown.replace(/[#*`_>|-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
  Component: ({ spec }) => (
    <div data-workplane="prose" data-generated={spec.generated ? "true" : undefined}>
      {renderBlocks(parseMarkdown(spec.markdown))}
      {spec.generated ? <span data-workplane="generated-badge">Generated</span> : null}
    </div>
  ),
};

// --- code -------------------------------------------------------------------

interface CodeSpec {
  code: string;
  language?: string;
  caption?: string;
}

const CODE_ALLOW: KeyTree = {
  // Source is displayed, never executed, never parsed. `=>` and `function(` are
  // the normal contents of a code sample, not a smuggling attempt.
  code: { $verbatim: true },
  language: true,
  caption: true,
};

export const codeRenderer: RendererDefinition<CodeSpec> = {
  id: "workplane.code",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: false, selection: false, thumbnail: false,
    staticExport: true, suspend: false, requiresWebGL: false,
  },
  validate(spec: unknown) {
    const result = sanitizeSpec<CodeSpec>(spec, {
      allow: CODE_ALLOW,
      limits: { maxDepth: 3, maxNodes: 32, maxBytes: 128 * 1024, maxArrayLength: 4, maxStringLength: 64 * 1024 },
    });
    if (!result.ok) {
      const first = result.violations[0]!;
      return { ok: false as const, message: first.message, path: first.path };
    }
    if (typeof result.value !== "object" || result.value === null || Array.isArray(result.value)) {
      return { ok: false as const, message: "Spec must be an object" };
    }
    if (typeof result.value.code !== "string" || result.value.code.length === 0) {
      return { ok: false as const, message: '"code" must be a non-empty string', path: "/code" };
    }
    if (result.value.language !== undefined && !/^[A-Za-z0-9+#._-]{1,24}$/.test(result.value.language)) {
      return { ok: false as const, message: '"language" must be a short identifier', path: "/language" };
    }
    return { ok: true as const, value: result.value };
  },
  summarize: (spec) => `${spec.language ?? "code"} sample, ${spec.code.split("\n").length} lines`,
  Component: ({ spec }) => (
    <figure data-workplane="code-block">
      <pre data-workplane="code" data-language={spec.language}>
        {/* A text node. There is no highlighting pass, so there is no path by
            which the sample could be interpreted rather than shown. */}
        <code>{spec.code}</code>
      </pre>
      {spec.caption ? <figcaption>{spec.caption}</figcaption> : null}
    </figure>
  ),
};
