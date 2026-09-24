/**
 * Standard error codes. Every code is safe to show a user and safe to log.
 * An error carries a correlation ID and retry guidance; it never carries a
 * secret, a connection string, or another tenant's data.
 */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "FORBIDDEN",
  "CONFLICT",
  "IDEMPOTENCY_MISMATCH",
  "UNSUPPORTED_RENDERER",
  "UNSUPPORTED_VERSION",
  "DATA_UNAVAILABLE",
  "APPROVAL_REQUIRED",
  "RESOURCE_LIMIT",
  "STALE_RESULT",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type RetryGuidance =
  /** The same request will fail the same way. Change it. */
  | "do-not-retry"
  /** Re-read the current revision, rebase, and issue a NEW command id. */
  | "rebase-and-retry"
  /** Transient. The identical request may be retried with backoff. */
  | "retry-with-backoff"
  /** A human must approve before this can proceed. */
  | "await-approval";

export interface WorkplaneError {
  code: ErrorCode;
  /** Safe, human-readable. Never interpolate document values or secrets. */
  message: string;
  /** Links user intent -> command -> query/action -> job -> artifact. */
  correlationId: string;
  retry: RetryGuidance;
  /**
   * JSON Pointer into the offending transaction, when the failure is
   * attributable to one operation. Agents use this to repair a proposal.
   */
  path?: string;
  /**
   * Bounded, non-sensitive detail: the current revision on CONFLICT, the
   * unsupported renderer id, the limit that was exceeded.
   */
  detail?: Record<string, string | number | boolean>;
}

const DEFAULT_RETRY: Record<ErrorCode, RetryGuidance> = {
  VALIDATION_FAILED: "do-not-retry",
  FORBIDDEN: "do-not-retry",
  CONFLICT: "rebase-and-retry",
  IDEMPOTENCY_MISMATCH: "do-not-retry",
  UNSUPPORTED_RENDERER: "do-not-retry",
  UNSUPPORTED_VERSION: "do-not-retry",
  DATA_UNAVAILABLE: "retry-with-backoff",
  APPROVAL_REQUIRED: "await-approval",
  RESOURCE_LIMIT: "do-not-retry",
  STALE_RESULT: "rebase-and-retry",
  INTERNAL_ERROR: "retry-with-backoff",
};

export interface ErrorInit {
  correlationId: string;
  path?: string;
  detail?: Record<string, string | number | boolean>;
  retry?: RetryGuidance;
}

export function workplaneError(
  code: ErrorCode,
  message: string,
  init: ErrorInit,
): WorkplaneError {
  const error: WorkplaneError = {
    code,
    message,
    correlationId: init.correlationId,
    retry: init.retry ?? DEFAULT_RETRY[code],
  };
  if (init.path !== undefined) error.path = init.path;
  if (init.detail !== undefined) error.detail = init.detail;
  return error;
}
