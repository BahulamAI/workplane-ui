import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LocalAuthority,
  WorkplaneController,
  type PresentationMode,
} from "@bahulam/workplane-core";
import {
  createNativeRegistry,
  createPresenterRegistry,
  Presenter,
  useControllerState,
  useViewState,
  useWorkplaneContext,
  WorkplaneProvider,
} from "@bahulam/workplane-react";
import { echartsRenderer } from "@bahulam/workplane-renderer-echarts";
import {
  createDemoDocument,
  DEMO_AGENT,
  DEMO_DOCUMENT_ID,
  DEMO_POLICY,
  DEMO_USER,
  OVERVIEW_OPERATIONS,
  SCENARIO_OPERATIONS,
  SyntheticCostProvider,
  transaction,
} from "@bahulam/workplane-testkit";
import { scenarioRenderer } from "./scenario-renderer.js";
import { LocalStorageAdapter, viewPreferences } from "./storage.js";

/**
 * The counter that matters. Nothing in this demo can increment it, because
 * nothing in this demo calls a model — filtering, selecting, and changing an
 * assumption are all deterministic paths through the command gateway.
 */
let modelCalls = 0;

function Toolbar({
  onRunAgent,
  onReset,
  queryCount,
  agentBusy,
}: {
  onRunAgent: () => void;
  onReset: () => void;
  queryCount: number;
  agentBusy: boolean;
}): React.ReactNode {
  const { document, epoch } = useControllerState();
  const { controller } = useWorkplaneContext();
  const view = useViewState();

  return (
    <div className="toolbar">
      <div className="toolbar-stats">
        <span>
          revision <strong>{document?.revision ?? 0}</strong>
        </span>
        <span>
          epoch <strong>{epoch.epoch}</strong>
        </span>
        <span>
          queries run <strong>{queryCount}</strong>
        </span>
        <span className="toolbar-model">
          model calls <strong>{modelCalls}</strong>
        </span>
      </div>
      <div className="toolbar-actions">
        <label htmlFor="mode">Presentation</label>
        <select
          id="mode"
          value={view.mode}
          onChange={(event) => {
            const mode = event.target.value as PresentationMode;
            // A mode switch is a view preference: it does not recreate the
            // controller, rerun the agent, or change the document revision.
            controller.session.patchViewState({ mode });
            viewPreferences.write(DEMO_DOCUMENT_ID, { mode });
          }}
        >
          <option value="document">Document</option>
          <option value="feed">Feed</option>
          <option value="stack">Stack</option>
        </select>
        <button type="button" onClick={onRunAgent} disabled={agentBusy}>
          {agentBusy ? "Agent working…" : "Run scripted agent"}
        </button>
        <button type="button" onClick={onReset}>
          Reset demo
        </button>
      </div>
    </div>
  );
}

export function App(): React.ReactNode {
  const [controller, setController] = useState<WorkplaneController | null>(null);
  const [queryCount, setQueryCount] = useState(0);
  const [agentBusy, setAgentBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const storageRef = useRef<LocalStorageAdapter | null>(null);

  const renderers = useMemo(
    () => createNativeRegistry().register(echartsRenderer).register(scenarioRenderer),
    [],
  );
  const presenters = useMemo(() => createPresenterRegistry(), []);

  useEffect(() => {
    let disposed = false;

    const storage = new LocalStorageAdapter("workplane.demo", createDemoDocument());
    storageRef.current = storage;

    const provider = new SyntheticCostProvider({
      latencyMs: 120,
      onExecute: () => setQueryCount((n) => n + 1),
    });

    const authority = new LocalAuthority({ storage, policy: DEMO_POLICY });
    const next = new WorkplaneController({
      gateway: authority,
      documentId: DEMO_DOCUMENT_ID,
      actor: DEMO_USER,
      provider,
      debounceMs: 250,
    });

    void (async () => {
      await next.load();
      if (disposed) return;

      // First run only: the agent lays out the overview. On reload the
      // committed document comes back instead, at its stored revision.
      if ((next.document?.sceneOrder.length ?? 0) === 0) {
        await authority.commit(
          transaction("cmd_overview_seed", next.revision, OVERVIEW_OPERATIONS),
          DEMO_AGENT,
        );
      }

      const saved = viewPreferences.read(DEMO_DOCUMENT_ID);
      next.session.patchViewState({
        mode: (saved.mode as PresentationMode) ?? "document",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });

      setController(next);
    })();

    return () => {
      disposed = true;
      next.dispose();
    };
  }, []);

  const runAgent = useCallback(async () => {
    if (!controller) return;
    setAgentBusy(true);
    setNotice(null);
    try {
      // The "agent" proposes a transaction through exactly the same gateway a
      // button uses. Its capabilities come from the host, not from this code.
      const result = await controller.commit(SCENARIO_OPERATIONS);
      if (!result.ok) {
        setNotice(
          result.error.code === "VALIDATION_FAILED" && /already exists/.test(result.error.message)
            ? "The scenario scene already exists."
            : `${result.error.code}: ${result.error.message}`,
        );
      }
    } finally {
      setAgentBusy(false);
    }
  }, [controller]);

  const reset = useCallback(() => {
    storageRef.current?.clear();
    localStorage.removeItem(`workplane.view.${DEMO_DOCUMENT_ID}`);
    window.location.reload();
  }, []);

  if (!controller) {
    return <p className="loading">Loading workspace…</p>;
  }

  return (
    <WorkplaneProvider controller={controller} renderers={renderers}>
      <div className="app">
        <Toolbar
          onRunAgent={() => void runAgent()}
          onReset={reset}
          queryCount={queryCount}
          agentBusy={agentBusy}
        />
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <Presenter controller={controller} registry={presenters} />
        <footer className="footer">
          Synthetic fixture. These are test values chosen to make the arithmetic exact — not Azure
          pricing estimates. No network call, no credential, no model.
        </footer>
      </div>
    </WorkplaneProvider>
  );
}
