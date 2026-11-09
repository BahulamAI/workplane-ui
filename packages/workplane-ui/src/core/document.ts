import type {
  BindingRef,
  JsonObject,
  JsonValue,
  SceneLayout,
} from "../protocol/index.js";

export const SCHEMA_VERSION = "workplane/1" as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

export interface Scene {
  id: string;
  title: string;
  layout: SceneLayout;
  blockOrder: string[];
  parameters: JsonObject;
}

export interface Block {
  id: string;
  kind: string;
  title: string;
  rendererId: string;
  specVersion: string;
  spec: JsonValue;
  bindings: Record<string, BindingRef>;
  dataRefs: string[];
  fallback: string;
}

/**
 * Identity and schema of a source — never a connection string, never a
 * credential. The data adapter receives an authenticated execution context
 * from the host; it does not trust a tenant id read out of the document.
 */
export interface DataSourceDescriptor {
  id: string;
  provider: string;
  resource: string;
  sourceVersion: string;
  /** Column name -> declared type. Semantics live with the provider. */
  schema: Record<string, "string" | "number" | "integer" | "boolean" | "date">;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
}

export interface QueryDescriptor {
  id: string;
  dataSourceId: string;
  /** Adapter-specific, validated by that adapter. Not SQL by default. */
  spec: JsonValue;
  /** Parameter name -> where its value comes from in the document. */
  parameters: Record<string, BindingRef>;
}

export type ArtifactState = "pending" | "available" | "unavailable" | "revoked";

/**
 * Opaque artifact identity. Access URLs are resolved just in time by the host;
 * an expiring signed URL is never persisted here.
 */
export interface ArtifactDescriptor {
  id: string;
  mimeType: string;
  state: ArtifactState;
  byteSize?: number;
  digest?: string;
  createdAt?: string;
  producedByJobId?: string;
  /** Fingerprint of the inputs that produced it, for staleness labelling. */
  inputFingerprint?: string;
}

export interface WorkplaneDocument {
  schemaVersion: SchemaVersion;
  id: string;
  revision: number;
  title: string;
  sceneOrder: string[];
  scenes: Record<string, Scene>;
  blocks: Record<string, Block>;
  /** Committed business state: filters, assumptions, selections. */
  shared: JsonObject;
  dataSources: Record<string, DataSourceDescriptor>;
  queries: Record<string, QueryDescriptor>;
  artifacts: Record<string, ArtifactDescriptor>;
}

export function createDocument(init: {
  id: string;
  title: string;
  shared?: JsonObject;
  dataSources?: Record<string, DataSourceDescriptor>;
  queries?: Record<string, QueryDescriptor>;
}): WorkplaneDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: init.id,
    revision: 0,
    title: init.title,
    sceneOrder: [],
    scenes: {},
    blocks: {},
    shared: init.shared ?? {},
    dataSources: init.dataSources ?? {},
    queries: init.queries ?? {},
    artifacts: {},
  };
}

/** The scene that owns a block. In v0.1 a block belongs to exactly one. */
export function sceneIdOfBlock(
  document: WorkplaneDocument,
  blockId: string,
): string | undefined {
  for (const sceneId of document.sceneOrder) {
    if (document.scenes[sceneId]?.blockOrder.includes(blockId)) return sceneId;
  }
  return undefined;
}

export function blocksOfScene(
  document: WorkplaneDocument,
  sceneId: string,
): Block[] {
  const scene = document.scenes[sceneId];
  if (!scene) return [];
  return scene.blockOrder
    .map((id) => document.blocks[id])
    .filter((b): b is Block => b !== undefined);
}
