import type { Actor } from "../core/index.js";

/** A human editor. Capabilities come from the host session, never a payload. */
export const DEMO_USER: Actor = {
  id: "user_local",
  type: "user",
  label: "You",
  capabilities: ["workplane.edit"],
};

/** The scripted agent. Same gateway, same policy, same validation. */
export const DEMO_AGENT: Actor = {
  id: "agent_cost_analyst",
  type: "agent",
  label: "Cost analyst",
  capabilities: ["workplane.edit"],
};

/** An actor with read access only, for authorization tests. */
export const DEMO_VIEWER: Actor = {
  id: "user_viewer",
  type: "user",
  label: "Viewer",
  capabilities: [],
};
