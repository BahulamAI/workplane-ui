import { useState } from "react";
import { sanitizeSpec, type KeyTree } from "../../core/index.js";
import type { JsonValue } from "../../protocol/index.js";
import type { RendererDefinition } from "../registry.js";

/**
 * A button requests a REGISTERED action.
 *
 * PRD-108 section 11.2: it declares an action id and typed arguments. It cannot
 * carry JavaScript, a shell command, a URL, or an arbitrary tool name — the
 * host maps action ids to handlers, so what a button can do is decided by the
 * plugin manifest and not by whoever wrote the block.
 *
 * The same broker serves an agent's request, which is what makes AC-10 true:
 * a click and a model proposal traverse identical authorization.
 */
interface ButtonSpec {
  actionId: string;
  label: string;
  arguments?: Record<string, JsonValue>;
  /** Shown before the action runs. Presence alone marks it as needing a decision. */
  confirm?: string;
  tone?: "default" | "primary" | "danger";
}

const BUTTON_ALLOW: KeyTree = {
  actionId: true,
  label: true,
  // Arguments are free-form JSON, still subject to the envelope: no URLs, no
  // executable content, bounded size.
  arguments: true,
  confirm: true,
  tone: true,
};

export const buttonRenderer: RendererDefinition<ButtonSpec> = {
  id: "workplane.button",
  specVersions: ["1"],
  trust: "host-reviewed",
  capabilities: {
    interactive: true, selection: false, thumbnail: false,
    staticExport: false, suspend: false, requiresWebGL: false,
  },
  validate(spec: unknown) {
    const result = sanitizeSpec<ButtonSpec>(spec, {
      allow: BUTTON_ALLOW,
      limits: { maxDepth: 6, maxNodes: 200, maxBytes: 16 * 1024, maxArrayLength: 50, maxStringLength: 2048 },
    });
    if (!result.ok) {
      const first = result.violations[0]!;
      return { ok: false as const, message: first.message, path: first.path };
    }
    if (typeof result.value !== "object" || result.value === null || Array.isArray(result.value)) {
      return { ok: false as const, message: "Spec must be an object" };
    }
    const { actionId, label } = result.value;
    // A registered id, not a path, a URL, or a tool name.
    if (typeof actionId !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/i.test(actionId)) {
      return {
        ok: false as const,
        message:
          '"actionId" must be a registered action identifier such as "check_answer". ' +
          "A button cannot name a tool, a URL, or a command.",
        path: "/actionId",
      };
    }
    if (typeof label !== "string" || label.trim().length === 0) {
      return { ok: false as const, message: '"label" must say what the button does', path: "/label" };
    }
    return { ok: true as const, value: result.value };
  },
  summarize: (spec) => `button "${spec.label}" requesting ${spec.actionId}`,
  Component: ({ spec, emit }) => {
    const [state, setState] = useState<{ status: "idle" | "confirming" | "sent"; message?: string }>({
      status: "idle",
    });

    const request = () => {
      emit({
        type: "action.request",
        payload: { actionId: spec.actionId, arguments: spec.arguments ?? {} },
      });
      setState({ status: "sent" });
      window.setTimeout(() => setState({ status: "idle" }), 2500);
    };

    if (state.status === "confirming" && spec.confirm) {
      return (
        <div data-workplane="confirm" role="alertdialog" aria-label={spec.label}>
          <p>{spec.confirm}</p>
          <button type="button" onClick={request} data-tone="danger">Yes, {spec.label.toLowerCase()}</button>
          <button type="button" onClick={() => setState({ status: "idle" })}>Cancel</button>
        </div>
      );
    }

    return (
      <div data-workplane="action">
        <button
          type="button"
          data-tone={spec.tone ?? "default"}
          onClick={() => (spec.confirm ? setState({ status: "confirming" }) : request())}
        >
          {spec.label}
        </button>
        {state.status === "sent" ? <span data-workplane="action-sent" role="status">Requested…</span> : null}
      </div>
    );
  },
};
