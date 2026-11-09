import { useState } from "react";
import type { RendererDefinition } from "../registry.js";
import { buttonContract, type ButtonSpec } from "../../renderers/index.js";

export const buttonRenderer: RendererDefinition<ButtonSpec> = {
  ...buttonContract,
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
