import type { ReactNode } from "react";
import type { RendererDefinition } from "../registry.js";
import { codeContract, markdownContract, type CodeSpec, type MarkdownSpec } from "../../renderers/index.js";
import { parseMarkdown, type Inline, type MarkdownNode } from "./markdown.js";

// --- markdown ---------------------------------------------------------------

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
  ...markdownContract,
  Component: ({ spec }) => (
    <div data-workplane="prose" data-generated={spec.generated ? "true" : undefined}>
      {renderBlocks(parseMarkdown(spec.markdown))}
      {spec.generated ? <span data-workplane="generated-badge">Generated</span> : null}
    </div>
  ),
};

// --- code -------------------------------------------------------------------

export const codeRenderer: RendererDefinition<CodeSpec> = {
  ...codeContract,
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
