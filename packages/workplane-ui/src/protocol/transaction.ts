import type { JsonObject, JsonValue } from "./json.js";

export const PROTOCOL_VERSION = "workplane/1" as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export type SceneLayout = "flow" | "grid";

export interface SceneInput {
  id: string;
  title: string;
  layout?: SceneLayout;
  /** Parameter defaults for this scene. Not a place for secrets or data. */
  parameters?: JsonObject;
}

export interface BindingRef {
  scope: "shared" | "result";
  /** JSON Pointer, relative to the scope root. */
  path: string;
}

export interface BlockInput {
  id: string;
  kind: string;
  title: string;
  rendererId: string;
  specVersion: string;
  spec: JsonValue;
  bindings?: Record<string, BindingRef>;
  dataRefs?: string[];
  /** Accessible text shown when the renderer is missing or data is revoked. */
  fallback?: string;
}

/**
 * Anchor semantics, applied identically to scenes and blocks:
 *   field omitted        -> append to the end
 *   field present, null  -> insert at the beginning
 *   field present, id    -> insert after that sibling
 *
 * `undefined` and `null` therefore mean different things, which is why these
 * are optional-and-nullable rather than merely optional.
 */
export type Anchor = string | null | undefined;

export type Operation =
  | { op: "scene.add"; scene: SceneInput; afterSceneId?: Anchor }
  | { op: "scene.update"; sceneId: string; patch: Partial<Pick<SceneInput, "title" | "layout" | "parameters">> }
  | { op: "scene.remove"; sceneId: string; blocks?: "reject" | "cascade" }
  | { op: "scene.move"; sceneId: string; afterSceneId?: Anchor }
  | { op: "block.add"; sceneId: string; block: BlockInput; afterBlockId?: Anchor }
  | { op: "block.update"; blockId: string; patch: BlockPatch }
  | { op: "block.remove"; blockId: string }
  | { op: "block.move"; blockId: string; sceneId: string; afterBlockId?: Anchor }
  /** `path` is relative to the document's `shared` object, never its root. */
  | { op: "state.set"; path: string; value: JsonValue };

/** Block update replaces explicitly supplied fields, not hidden metadata. */
export interface BlockPatch {
  title?: string;
  spec?: JsonValue;
  bindings?: Record<string, BindingRef>;
  dataRefs?: string[];
  fallback?: string;
}

export const OPERATION_KINDS = [
  "scene.add",
  "scene.update",
  "scene.remove",
  "scene.move",
  "block.add",
  "block.update",
  "block.remove",
  "block.move",
  "state.set",
] as const;

export interface Transaction {
  protocolVersion: ProtocolVersion;
  documentId: string;
  /** Idempotency key. Reusing it after a conflict is prohibited. */
  commandId: string;
  expectedRevision: number;
  operations: Operation[];
}

/**
 * Who is acting. Supplied out of band by the host from the authenticated
 * session — a body field claiming to be an administrator is not authority,
 * which is why this is not part of `Transaction`.
 */
export interface Actor {
  id: string;
  type: "user" | "agent" | "system";
  /** Display label for provenance UI. Never used for an access decision. */
  label?: string;
  /** Capability ids granted to this actor for this document. */
  capabilities: readonly string[];
}

export interface CommittedEvent {
  documentId: string;
  revision: number;
  commandId: string;
  operations: readonly Operation[];
  actor: { id: string; type: Actor["type"]; label?: string };
  committedAt: string;
  /**
   * Content-addressed identity of this commit, and the commit it extends.
   *
   * Optional only because documents written before content addressing exist.
   * Every new commit carries both, and history verification reports a missing
   * id as "unverifiable" rather than pretending the chain is sound.
   */
  commitId?: string;
  parentId?: string | null;
}
