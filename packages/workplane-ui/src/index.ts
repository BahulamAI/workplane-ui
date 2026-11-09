/**
 * Headless entry point: document model, invariant validator, pure reducer,
 * command gateway, policy, session store, controller, and the query and data
 * contracts.
 *
 * Imports no React and no chart engine, so this is what a server, a CLI, or a
 * non-React host installs.
 */
export * from "./core/index.js";
export * from "./data/index.js";
export * from "./renderers/index.js";
