/**
 * A deliberately small Markdown subset, parsed to a token tree.
 *
 * There is no HTML string anywhere in this path: tokens become React elements,
 * so there is nothing to sanitize and no `dangerouslySetInnerHTML` to get wrong.
 * That is the same reasoning as the plain-text block, extended to structure.
 *
 * Supported: headings, paragraphs, unordered and ordered lists, fenced code,
 * blockquotes, horizontal rules, tables, and inline emphasis, strong, code and
 * links. Everything else is rendered as the literal text it was written as —
 * an unsupported construct shows up rather than disappearing.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export type MarkdownNode =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; language: string | null; text: string }
  | { kind: "quote"; children: Inline[] }
  | { kind: "rule" }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]*\]\([^)\s]*\))/;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) out.push({ kind: "text", text: rest.slice(0, match.index) });
    const token = match[0];

    if (token.startsWith("`")) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push({ kind: "strong", children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      out.push({ kind: "link", href, children: parseInline(label) });
    } else {
      out.push({ kind: "em", children: parseInline(token.slice(1, -1)) });
    }
    rest = rest.slice(match.index + token.length);
  }
  return out.filter((node) => node.kind !== "text" || node.text.length > 0);
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseMarkdown(source: string, maxNodes = 500): MarkdownNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const nodes: MarkdownNode[] = [];
  let index = 0;

  const paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    nodes.push({ kind: "paragraph", children: parseInline(paragraph.join(" ").trim()) });
    paragraph.length = 0;
  };

  while (index < lines.length && nodes.length < maxNodes) {
    const line = lines[index] as string;

    if (line.trim() === "") { flush(); index += 1; continue; }

    // Fenced code. Everything inside is literal, including further fences'
    // worth of markdown — a lesson quoting markdown must not have it parsed.
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const language = fence[1] ? fence[1] : null;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1;
      nodes.push({ kind: "code", language, text: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      nodes.push({
        kind: "heading",
        level: (heading[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline((heading[2] as string).trim()),
      });
      index += 1;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flush();
      nodes.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const body = [quote[1] as string];
      index += 1;
      while (index < lines.length && /^\s*>\s?/.test(lines[index] as string)) {
        body.push((lines[index] as string).replace(/^\s*>\s?/, ""));
        index += 1;
      }
      nodes.push({ kind: "quote", children: parseInline(body.join(" ")) });
      continue;
    }

    // Table: a header row, a separator of dashes, then body rows.
    if (line.includes("|") && /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(lines[index + 1] ?? "")) {
      flush();
      const head = splitRow(line).map(parseInline);
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && (lines[index] as string).includes("|")) {
        rows.push(splitRow(lines[index] as string).map(parseInline));
        index += 1;
      }
      nodes.push({ kind: "table", head, rows });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = lines[index] as string;
        const next = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(current) : /^\s*[-*+]\s+(.*)$/.exec(current);
        if (!next) break;
        items.push(parseInline((next[1] as string).trim()));
        index += 1;
      }
      nodes.push({ kind: "list", ordered, items });
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }
  flush();
  return nodes;
}
