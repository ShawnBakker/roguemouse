import type { S3Client } from "@aws-sdk/client-s3";

import type { AuditRecordBody } from "@roguemouse/schemas";

/**
 * Configuration for creating an S3 client targeting Vultr Object Storage.
 *
 * For Roguemouse the values are locked (per `.claude/rules/vultr.md`):
 *   endpoint: "https://ams1.vultrobjects.com"
 *   region:   "ams1"
 *   bucket:   "roguemouse-audit-log"
 *
 * The factory accepts them as arguments so `process.env` reads stay out of
 * the workspace package per the stack rule.
 */
export type S3ClientConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Input to `RunAuditWriter#append`.
 *
 * The writer fills in `previousHash` from its in-memory chain state and
 * `runId` from its constructor, so callers supply only the record-specific
 * fields. This is structurally `Omit<AuditRecordBody, "previousHash" | "runId">`.
 */
export type AppendInput = Omit<AuditRecordBody, "previousHash" | "runId">;

/**
 * Constructor arguments for `RunAuditWriter`.
 *
 * The `canonicalize` and `sha256Hex` functions are injected so the class is
 * testable with mock implementations and so callers can swap algorithms
 * without rewriting the writer. In production the smoke runner passes the
 * module's own `canonicalize` and `sha256Hex`.
 */
export type RunAuditWriterArgs = {
  s3Client: S3Client;
  bucket: string;
  runId: string;
  canonicalize: (value: unknown) => string;
  sha256Hex: (content: string) => string;
};

export type AppendData = {
  /** Full S3 object key the record was written to. */
  key: string;
  /** The record's SHA-256, 64-character lowercase hex. */
  hash: string;
  /** The `previousHash` field carried inside the written record. */
  previousHash: string;
  /** The exact canonical JSON body that was written (and that was hashed). */
  canonicalJson: string;
};

export type ReadData = {
  /** The S3 object key that was read. */
  key: string;
  /** Raw JSON body, decoded as UTF-8. */
  body: string;
  /** `JSON.parse(body)`. */
  parsed: unknown;
};

/**
 * Audit-writer error envelope. Returned through `AppendResult` or `ReadResult`
 * whenever an operation fails. Same envelope-discipline pattern as
 * `@roguemouse/inference`'s `InferenceError`.
 *
 * `retryable` follows standard HTTP + network conventions (5xx / 408 / 429 /
 * network errors are retryable; other 4xx / validation errors are not).
 * `step` identifies the writer phase that produced the error, useful for
 * forensic reporting.
 */
export type AuditError = {
  code: string;
  message: string;
  retryable: boolean;
  step?: string;
};

export type AppendResult =
  | { ok: true; data: AppendData }
  | { ok: false; error: AuditError };

export type ReadResult =
  | { ok: true; data: ReadData }
  | { ok: false; error: AuditError };
