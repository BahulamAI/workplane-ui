import type { JsonValue } from "../protocol/index.js";
import type { CommandGateway } from "./gateway.js";
import type { WorkplaneViewState } from "./session.js";

export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancellation-requested"
  | "canceled";

export interface Job {
  id: string;
  kind: string;
  state: JobState;
  progress?: number;
  /** Safe log lines. Never contains a credential or a signed URL. */
  log?: readonly string[];
  artifactId?: string;
  /** Inputs that produced it, so a later result can be labelled stale. */
  inputFingerprint?: string;
}

export interface ActionRequest {
  /** Registered id. Never a URL, a shell command, or a raw tool name. */
  actionId: string;
  arguments: Record<string, JsonValue>;
}

export type ActionOutcome =
  | { status: "completed"; result: JsonValue }
  | { status: "job"; jobId: string }
  | { status: "approval-required"; approvalId: string; summary: string };

export interface ActionBroker {
  /** Identical policy for a UI click and an agent proposal. */
  request(request: ActionRequest): Promise<ActionOutcome>;
  listRegistered(): Promise<ReadonlyArray<{ actionId: string; summary: string }>>;
}

export interface ArtifactResolver {
  /** Resolves just in time. The expiring URL is never persisted. */
  resolve(artifactId: string): Promise<{ url: string; expiresAt: string } | undefined>;
}

export interface JobProvider {
  get(jobId: string): Promise<Job | undefined>;
  cancel(jobId: string): Promise<void>;
  subscribe(jobId: string, listener: (job: Job) => void): () => void;
}

export interface PreferenceStore {
  /** View preferences persist separately from the business document. */
  read(documentId: string): Promise<Partial<WorkplaneViewState> | undefined>;
  write(documentId: string, view: Partial<WorkplaneViewState>): Promise<void>;
}

export interface TelemetrySink {
  /** Ids, timings, status, sizes, policy outcomes — not document values. */
  record(event: { name: string; correlationId?: string; attributes: Record<string, string | number | boolean> }): void;
}

/**
 * Everything Workplane needs from its host. An implementation can be local
 * functions, an HTTP client, or a bridge into an existing application.
 *
 * Optional members announce availability; an absent service produces an
 * explicit unsupported state in the UI rather than a silent no-op.
 */
export interface HostServices {
  commands: CommandGateway;
  actions?: ActionBroker;
  artifacts?: ArtifactResolver;
  jobs?: JobProvider;
  preferences?: PreferenceStore;
  telemetry?: TelemetrySink;
}
