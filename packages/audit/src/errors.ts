import { S3ServiceException } from "@aws-sdk/client-s3";

import type { AuditError } from "./types.js";

/**
 * Classify a thrown error from the AWS S3 SDK (or its transport layer) into
 * the `AuditError` shape.
 *
 * Retryability follows standard HTTP + network conventions:
 *   - HTTP 408 (request timeout), 429 (rate limit / throttling), 5xx → retryable.
 *   - HTTP 4xx other than 408/429 (auth, not-found, validation) → not retryable.
 *   - Node network errors (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`,
 *     `ECONNRESET`) → retryable.
 *   - Anything else → not retryable.
 *
 * The `step` parameter records which writer phase was in flight when the
 * error occurred, so forensic output can pinpoint the failure surface
 * (`s3_put` vs `s3_get` vs `json_parse` vs `validate` vs `canonicalize`).
 *
 * Internal helper. Not exported from the package; consumers see only the
 * `AuditError` shape via the `AppendResult` / `ReadResult` envelopes.
 */
export function classifyS3Error(err: unknown, step: string): AuditError {
  if (err instanceof S3ServiceException) {
    const status = err.$metadata?.httpStatusCode;
    const code = err.name || `http_${status ?? "unknown"}`;

    if (typeof status === "number") {
      if (status === 408 || status === 429) {
        return { code, message: err.message, retryable: true, step };
      }
      if (status >= 500 && status < 600) {
        return { code, message: err.message, retryable: true, step };
      }
      if (status >= 400 && status < 500) {
        return { code, message: err.message, retryable: false, step };
      }
    }
    return { code, message: err.message, retryable: false, step };
  }

  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    if (
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "ECONNRESET"
    ) {
      return { code, message: err.message, retryable: true, step };
    }
    return {
      code: code ?? "unknown",
      message: err.message,
      retryable: false,
      step,
    };
  }

  return {
    code: "unknown",
    message: typeof err === "string" ? err : "Unknown error",
    retryable: false,
    step,
  };
}
