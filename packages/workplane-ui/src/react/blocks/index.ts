import { RendererRegistry } from "../registry.js";
import { formRenderer } from "./form.js";
import { metricRenderer } from "./metric.js";
import { tableRenderer } from "./table.js";
import { buttonRenderer } from "./button.js";
import { codeRenderer, markdownRenderer } from "./prose.js";
import { factRenderer, textRenderer } from "./text.js";

export { formRenderer, metricRenderer, tableRenderer, factRenderer, textRenderer, markdownRenderer, codeRenderer, buttonRenderer };
export { parseMarkdown, parseInline, type MarkdownNode, type Inline } from "./markdown.js";

/**
 * The native catalog. Deliberately small: register a component when a real
 * plugin needs it, not in anticipation of one.
 *
 * No chart engine appears here — charts arrive through an adapter package, so
 * the default dependency graph stays free of a BI SDK.
 */
export function createNativeRegistry(): RendererRegistry {
  return new RendererRegistry()
    .register(textRenderer)
    .register(markdownRenderer)
    .register(codeRenderer)
    .register(buttonRenderer)
    .register(factRenderer)
    .register(metricRenderer)
    .register(formRenderer)
    .register(tableRenderer);
}
