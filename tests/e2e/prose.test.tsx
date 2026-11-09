import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { codeRenderer, markdownRenderer, parseMarkdown } from "@bahulam/workplane-ui/react";
import { diagramRenderer } from "@bahulam/workplane-ui/diagram";

afterEach(cleanup);

const block = { id: "b", kind: "content.markdown", title: "T", rendererId: "workplane.markdown", specVersion: "1", spec: {}, bindings: {}, dataRefs: [], fallback: "F" };
const props = { block, results: new Map(), bindings: {}, stale: false, errors: new Map(), emit: () => {} } as never;

function renderMarkdown(markdown: string) {
  const outcome = markdownRenderer.validate({ markdown });
  if (!outcome.ok) throw new Error(`invalid: ${outcome.message}`);
  const { Component } = markdownRenderer;
  return render(<Component {...props} spec={outcome.value} />);
}

describe("markdown for a lesson", () => {
  it("renders the structure a lesson needs", () => {
    const { container } = renderMarkdown(
      "# Load balancers\n\n" +
      "A load balancer spreads requests across **several** servers.\n\n" +
      "## Strategies\n\n" +
      "- Round robin\n- Least connections\n- Consistent *hashing*\n\n" +
      "1. First\n2. Second\n\n" +
      "> Latency is not throughput.\n\n" +
      "Use `X-Forwarded-For` to keep the client address.\n\n" +
      "| Strategy | Cost |\n|---|---|\n| Round robin | low |\n| Hashing | medium |\n",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Load balancers" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Strategies" })).toBeDefined();
    expect(container.querySelectorAll("ul li")).toHaveLength(3);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("blockquote")?.textContent).toMatch(/Latency is not throughput/);
    expect(container.querySelector("code")?.textContent).toBe("X-Forwarded-For");
    expect(container.querySelectorAll("table tbody tr")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("several");
    expect(container.querySelector("em")?.textContent).toBe("hashing");
  });

  it("renders a fenced code block without interpreting it", () => {
    const { container } = renderMarkdown("```js\nconst a = () => fetch('https://x');\n```");
    const pre = container.querySelector("pre code");
    expect(pre?.textContent).toBe("const a = () => fetch('https://x');");
    expect(container.querySelector("script")).toBeNull();
  });

  it("cannot inject markup, because there is no HTML path", () => {
    const { container } = renderMarkdown(
      "Normal text <script>alert(1)</script> and <img src=x onerror=alert(2)> here",
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The angle brackets survive as literal characters, which is what a reader
    // wrote and what a reader should see.
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("links to http(s) only, and shows anything else as text", () => {
    const { container } = renderMarkdown(
      "[docs](https://example.com/x) and [bad](javascript:alert(1)) and [data](data:text/html,<b>)",
    );
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/x");
    expect(anchors[0]?.getAttribute("rel")).toContain("noopener");
    expect(container.textContent).toContain("javascript:alert(1)");
    expect(container.querySelector('[data-workplane="unsafe-link"]')).not.toBeNull();
  });

  it("accepts prose containing a URL, which the blanket rule would refuse", () => {
    // $verbatim exists for exactly this: a lesson mentioning a URL is normal.
    expect(markdownRenderer.validate({ markdown: "See https://example.com/spec for detail." }).ok).toBe(true);
  });

  it("bounds how much it will parse", () => {
    const many = Array.from({ length: 2000 }, (_, i) => `para ${i}`).join("\n\n");
    expect(parseMarkdown(many).length).toBeLessThanOrEqual(500);
  });

  it("refuses an empty document", () => {
    expect(markdownRenderer.validate({ markdown: "" }).ok).toBe(false);
  });
});

describe("code samples", () => {
  it("shows the source verbatim", () => {
    const outcome = codeRenderer.validate({
      code: "function handler(req) {\n  return fetch('https://api.example/x');\n}",
      language: "javascript",
      caption: "A request handler",
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
    if (!outcome.ok) return;
    const { Component } = codeRenderer;
    const { container } = render(<Component {...props} spec={outcome.value} />);
    expect(container.querySelector("code")?.textContent).toContain("fetch('https://api.example/x')");
    expect(container.querySelector("pre")?.getAttribute("data-language")).toBe("javascript");
    expect(within(container).getByText("A request handler")).toBeDefined();
  });

  it("rejects a language that is not a short identifier", () => {
    expect(codeRenderer.validate({ code: "x", language: "<script>" }).ok).toBe(false);
  });
});

describe("diagrams", () => {
  it("accepts mermaid source containing arrows", () => {
    const outcome = diagramRenderer.validate({
      diagram: "flowchart LR\n  Client --> LB\n  LB --> App1\n  LB ==> App2",
      alt: "A client reaching two app servers through a load balancer",
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.message).toBe(true);
  });

  it("requires an accessible description", () => {
    const outcome = diagramRenderer.validate({ diagram: "flowchart LR\n A --> B" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/readers who cannot see it/);
  });

  it("refuses an unsupported diagram kind by name", () => {
    const outcome = diagramRenderer.validate({ diagram: "explodingDiagram x", alt: "x" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/supported kind/);
  });

  it("summarises for agent context without dumping the source", () => {
    const outcome = diagramRenderer.validate({
      diagram: "sequenceDiagram\n  A->>B: request", alt: "A calls B",
    });
    if (!outcome.ok) throw new Error(outcome.message);
    expect(diagramRenderer.summarize(outcome.value)).toBe("sequenceDiagram diagram: A calls B");
  });
});
