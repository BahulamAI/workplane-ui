import { describe, expect, it } from "vitest";
import { SessionStore } from "@bahulam/workplane-ui";

describe("AC-03 — a user draft while an agent edits", () => {
  it("survives an unrelated agent change and still submits cleanly", () => {
    const session = new SessionStore();
    session.setDraft("assumptions.reductionPercent", 30, { value: 20, revision: 5 });
    // An agent commits something else entirely; revision moves to 6.
    const resolution = session.resolveDraft("assumptions.reductionPercent", 20);
    expect(resolution?.status).toBe("clean");
    expect(resolution?.draft.value).toBe(30);
  });

  it("surfaces a conflict rather than letting either side silently win", () => {
    const session = new SessionStore();
    session.setDraft("assumptions.reductionPercent", 30, { value: 20, revision: 5 });
    // The agent changed the SAME value underneath the user.
    const resolution = session.resolveDraft("assumptions.reductionPercent", 25);
    expect(resolution?.status).toBe("conflict");
    if (resolution?.status !== "conflict") return;
    expect(resolution.draft.value).toBe(30);
    expect(resolution.theirValue).toBe(25);
  });

  it("keeps the original baseline across keystrokes, so a conflict cannot be absorbed", () => {
    const session = new SessionStore();
    session.setDraft("field", 2, { value: 1, revision: 1 });
    session.setDraft("field", 3, { value: 99, revision: 2 }); // re-read baseline offered
    session.setDraft("field", 4, { value: 99, revision: 3 });
    expect(session.getDraft("field")?.baselineValue).toBe(1);
    expect(session.getDraft("field")?.baselineRevision).toBe(1);
    // Because the baseline was held, the concurrent change is still detected.
    expect(session.resolveDraft("field", 99)?.status).toBe("conflict");
  });

  it("reports a no-op submit as unchanged rather than committing a revision", () => {
    const session = new SessionStore();
    session.setDraft("field", 20, { value: 20, revision: 1 });
    expect(session.resolveDraft("field", 20)?.status).toBe("unchanged");
  });
});

describe("AC-14 — switching presentation mode", () => {
  it("preserves drafts, selection, and playback across a mode change", () => {
    const session = new SessionStore();
    session.setDraft("form.field", "half typed", { value: "", revision: 3 });
    session.setSelection("service_costs", ["compute"]);
    session.setPlaybackPosition("movie", 18);

    session.patchViewState({ mode: "feed" });
    session.patchViewState({ mode: "stack" });
    session.patchViewState({ mode: "document" });

    expect(session.getDraft("form.field")?.value).toBe("half typed");
    expect(session.getSelection("service_costs")).toEqual(["compute"]);
    expect(session.getPlaybackPosition("movie")).toBe(18);
  });

  it("keeps view state out of the business document entirely", () => {
    const session = new SessionStore();
    const view = session.getViewState();
    // Nothing here is a document field; there is no revision to bump.
    expect(view).not.toHaveProperty("revision");
    expect(Object.keys(view).sort()).toEqual([
      "activeSceneId",
      "feedAxis",
      "focusedBlockId",
      "followNewScenes",
      "historyRevision",
      "mode",
      "navigationDomain",
      "reducedMotion",
    ]);
  });

  it("notifies subscribers without recreating state", () => {
    const session = new SessionStore();
    let calls = 0;
    const unsubscribe = session.subscribe(() => { calls += 1; });
    session.patchViewState({ activeSceneId: "overview" });
    session.setDraft("k", 1, { value: 0, revision: 1 });
    unsubscribe();
    session.patchViewState({ activeSceneId: "scenario" });
    expect(calls).toBe(2);
  });
});
