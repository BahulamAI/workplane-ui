import { useCallback, useState } from "react";
import type { Operation } from "../../protocol/index.js";
import { useWorkplaneContext } from "../context.js";
import { useControllerState, useDraft } from "../hooks.js";
import type { RendererDefinition } from "../registry.js";
import { formContract, type FormField as Field, type FormSpec } from "../../renderers/index.js";

function FormField({ field }: { field: Field }): React.ReactNode {
  const draft = useDraft(field.path);
  const id = `field-${field.path.replace(/\//g, "-")}`;

  const onChange = useCallback(
    (raw: string | boolean) => {
      if (field.control === "number") {
        // An empty box is not zero. Keep it as a draft until it parses.
        const parsed = raw === "" ? Number.NaN : Number(raw);
        draft.change(Number.isNaN(parsed) ? (raw as string) : parsed);
      } else {
        draft.change(raw as string | boolean);
      }
    },
    [draft, field.control],
  );

  const value = draft.value;

  return (
    <div data-workplane="field" data-dirty={draft.isDirty ? "true" : undefined}>
      <label htmlFor={id}>{field.label}</label>
      {field.control === "select" ? (
        <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.control === "checkbox" ? (
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <input
          id={id}
          type={field.control === "number" ? "number" : "text"}
          value={value === undefined || value === null ? "" : String(value)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {draft.isDirty ? <span data-workplane="draft-badge">Unsaved</span> : null}
    </div>
  );
}

type SubmitState =
  | { status: "idle" }
  | { status: "conflict"; fields: Array<{ label: string; mine: unknown; theirs: unknown; path: string }> }
  | { status: "rejected"; message: string };

/**
 * A typed form over registered writable paths.
 *
 * Two properties matter more than the markup: typing commits nothing (so a
 * keystroke never wakes a model), and submitting sends ONE transaction for all
 * dirty fields (so a half-applied form is not a reachable state).
 */
export const formRenderer: RendererDefinition<FormSpec> = {
  ...formContract,
  Component: ({ spec }) => {
    const { controller } = useWorkplaneContext();
    const { document } = useControllerState();
    const [state, setState] = useState<SubmitState>({ status: "idle" });

    const submit = useCallback(
      async (event: React.FormEvent) => {
        event.preventDefault();
        if (!document) return;

        const operations: Operation[] = [];
        const conflicts: Array<{ label: string; mine: unknown; theirs: unknown; path: string }> = [];

        for (const field of spec.fields) {
          const committed = controller.resolveBinding(field.path);
          const resolution = controller.session.resolveDraft(field.path, committed as never);
          if (!resolution) continue;
          if (resolution.status === "unchanged") {
            controller.session.clearDraft(field.path);
            continue;
          }
          if (resolution.status === "conflict") {
            conflicts.push({
              label: field.label,
              mine: resolution.draft.value,
              theirs: resolution.theirValue,
              path: field.path,
            });
            continue;
          }
          operations.push({ op: "state.set", path: field.path, value: resolution.draft.value });
        }

        if (conflicts.length > 0) {
          setState({ status: "conflict", fields: conflicts });
          return;
        }
        if (operations.length === 0) {
          setState({ status: "idle" });
          return;
        }

        const result = await controller.commit(operations);
        if (!result.ok) {
          setState({ status: "rejected", message: result.error.message });
          return;
        }
        for (const operation of operations) {
          if (operation.op === "state.set") controller.session.clearDraft(operation.path);
        }
        setState({ status: "idle" });
      },
      [controller, document, spec.fields],
    );

    const keepMine = useCallback(
      async (path: string) => {
        const draft = controller.session.getDraft(path);
        if (!draft) return;
        const result = await controller.setSharedValue(path, draft.value);
        if (result.ok) controller.session.clearDraft(path);
        setState({ status: "idle" });
      },
      [controller],
    );

    const takeTheirs = useCallback(
      (path: string) => {
        controller.session.clearDraft(path);
        setState({ status: "idle" });
      },
      [controller],
    );

    return (
      <form data-workplane="form" onSubmit={submit}>
        {spec.fields.map((field) => (
          <FormField key={field.path} field={field} />
        ))}

        {state.status === "conflict" ? (
          <div data-workplane="conflict" role="alert">
            <p>This changed while you were editing. Choose which value to keep.</p>
            {state.fields.map((conflict) => (
              <div key={conflict.path} data-workplane="conflict-row">
                <span>{conflict.label}</span>
                <button type="button" onClick={() => void keepMine(conflict.path)}>
                  Keep mine ({String(conflict.mine)})
                </button>
                <button type="button" onClick={() => takeTheirs(conflict.path)}>
                  Take theirs ({String(conflict.theirs)})
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {state.status === "rejected" ? (
          <p data-workplane="form-error" role="alert">
            {state.message}
          </p>
        ) : null}

        <button type="submit" data-workplane="form-submit">
          {spec.submitLabel}
        </button>
      </form>
    );
  },
};
