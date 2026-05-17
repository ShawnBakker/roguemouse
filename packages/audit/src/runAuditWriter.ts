import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { auditRecordBodySchema } from "@roguemouse/schemas";

import { classifyS3Error } from "./errors.js";
import { GENESIS_HASH } from "./genesis.js";
import type {
  AppendInput,
  AppendResult,
  ListResult,
  ReadResult,
  RunAuditWriterArgs,
} from "./types.js";

/**
 * Replace `:` with `-` in an ISO-8601 timestamp so it's safe to embed in an
 * S3 object key without URL-encoding. Per spec AC-17 the timestamp portion
 * of the key uses this `ts-safe` form.
 */
function tsSafe(ts: string): string {
  return ts.replace(/:/g, "-");
}

/**
 * Build the S3 object key for an audit record under the locked layout from
 * spec AC-17:
 *   `audit/{runId}/{ts-safe}-{hash}.json`
 */
function buildKey(runId: string, ts: string, hash: string): string {
  return `audit/${runId}/${tsSafe(ts)}-${hash}.json`;
}

/**
 * Append-and-read writer for a single audit chain (one `runId`).
 *
 * Holds the chain's `lastHash` in a private instance field, initialized to
 * `GENESIS_HASH` on construction. Each `append` uses the current `lastHash`
 * as `previousHash`, computes the new record's hash, then advances
 * `lastHash`. Sprint 2's smoke runner constructs a fresh writer per
 * invocation, so each run is its own chain rooted at genesis.
 *
 * The `canonicalize` and `sha256Hex` functions are injected via the
 * constructor so the class is testable with mock implementations and
 * decoupled from the audit module's own static exports. In production the
 * smoke runner passes the module's `canonicalize` and `sha256Hex` directly.
 *
 * Neither `append` nor `read` ever throws — both return discriminated-union
 * envelopes (`AppendResult` / `ReadResult`). This is the same
 * envelope-discipline rule as `@roguemouse/inference`.
 *
 * The writer offers no delete API. Per spec AC-25 ("On FAIL after a
 * successful S3 write, the runner does not delete or modify the written
 * audit record"), this is enforced by construction.
 *
 * Sprint 4b adds `list` (S3 `ListObjectsV2`) to support `audit:search` and
 * end-to-end chain verification. The method is single-page (no auto-
 * pagination); callers see `hasMore` and decide whether to re-call with a
 * narrower prefix.
 */
export class RunAuditWriter {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly runId: string;
  private readonly canonicalize: (value: unknown) => string;
  private readonly sha256Hex: (content: string) => string;
  private lastHash: string;

  constructor(args: RunAuditWriterArgs) {
    this.s3Client = args.s3Client;
    this.bucket = args.bucket;
    this.runId = args.runId;
    this.canonicalize = args.canonicalize;
    this.sha256Hex = args.sha256Hex;
    this.lastHash = GENESIS_HASH;
  }

  /**
   * Append one record to the audit log. Returns an `AppendResult` envelope —
   * never throws. On success, advances the in-memory `lastHash` so the next
   * append's `previousHash` chains correctly. On failure, `lastHash` is
   * unchanged, so the chain can resume from a retry.
   *
   * Steps:
   *   1. Combine `input` with `this.runId` and `this.lastHash` into the
   *      full record body.
   *   2. Validate against `auditRecordBodySchema` (Zod).
   *   3. Canonicalize via the injected canonicalizer.
   *   4. Hash the canonical form via the injected hasher.
   *   5. Build the object key.
   *   6. PutObject to S3 with the canonical body and metadata sidecar.
   *   7. Update `lastHash`; return success.
   *
   * Any failure between steps 2-6 short-circuits to an envelope error. Step 1
   * cannot fail; step 7 only runs on success.
   */
  async append(input: AppendInput): Promise<AppendResult> {
    // The local `record` is intentionally not annotated as
    // `AuditRecordBody`. After Sprint 3 Phase 4, `AuditRecordBody`
    // is a discriminated union; assembling fields from `input`
    // independently loses the recordType ↔ payload correlation, so
    // an explicit annotation cannot find a matching branch even
    // though the resulting object IS valid. Runtime validation via
    // `safeParse` (which accepts `unknown`) remains the source of
    // truth.
    const record = {
      ts: input.ts,
      runId: this.runId,
      recordType: input.recordType,
      previousHash: this.lastHash,
      payload: input.payload,
    };

    const parseResult = auditRecordBodySchema.safeParse(record);
    if (!parseResult.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: `audit record failed schema validation: ${parseResult.error.message}`,
          retryable: false,
          step: "validate",
        },
      };
    }

    let canonicalJson: string;
    try {
      canonicalJson = this.canonicalize(parseResult.data);
    } catch (err: unknown) {
      return {
        ok: false,
        error: {
          code: "canonicalize_error",
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
          step: "canonicalize",
        },
      };
    }

    const previousHash = this.lastHash;
    const hash = this.sha256Hex(canonicalJson);
    const key = buildKey(this.runId, record.ts, hash);

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: canonicalJson,
          ContentType: "application/json",
          Metadata: {
            sha256: hash,
            previousHash,
          },
        }),
      );
    } catch (err: unknown) {
      return { ok: false, error: classifyS3Error(err, "s3_put") };
    }

    this.lastHash = hash;
    return {
      ok: true,
      data: { key, hash, previousHash, canonicalJson },
    };
  }

  /**
   * Read one audit record from the bucket by key. Returns a `ReadResult`
   * envelope — never throws. Used by the smoke runner to verify round-trip
   * integrity: read the just-written object, re-canonicalize, recompute the
   * hash, and assert it equals the hash captured at write time.
   *
   * The body is decoded as UTF-8. Vultr's gzip transport encoding is
   * transparently handled by the AWS SDK (per `.claude/rules/vultr.md`); we
   * do not manually inspect or decompress.
   */
  async read(key: string): Promise<ReadResult> {
    let body: string;
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        return {
          ok: false,
          error: {
            code: "empty_body",
            message: "S3 GetObject returned a response with no Body",
            retryable: true,
            step: "s3_get",
          },
        };
      }

      body = await response.Body.transformToString("utf-8");
    } catch (err: unknown) {
      return { ok: false, error: classifyS3Error(err, "s3_get") };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err: unknown) {
      return {
        ok: false,
        error: {
          code: "json_parse_error",
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
          step: "json_parse",
        },
      };
    }

    return { ok: true, data: { key, body, parsed } };
  }

  /**
   * List audit object keys under the bucket. Returns a `ListResult`
   * envelope — never throws. Single-page semantics: one `ListObjectsV2`
   * call against the chosen prefix, capped at `limit` (default 100).
   * `hasMore` reflects S3's `IsTruncated` flag; callers paginate by
   * re-calling with a narrower `runIdPrefix` or accept the partial view.
   *
   * `runIdPrefix` is the run UUID (no `audit/` prefix, no trailing
   * slash). When omitted, the LIST scans the whole `audit/` namespace,
   * which is appropriate only for ad-hoc diagnostics; production paths
   * always supply a `runIdPrefix`.
   */
  async list(args: {
    runIdPrefix?: string;
    limit?: number;
  }): Promise<ListResult> {
    const prefix =
      args.runIdPrefix !== undefined ? `audit/${args.runIdPrefix}/` : "audit/";
    const maxKeys = args.limit ?? 100;
    try {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
        }),
      );
      const keys: string[] = [];
      for (const obj of response.Contents ?? []) {
        if (typeof obj.Key === "string") {
          keys.push(obj.Key);
        }
      }
      return {
        ok: true,
        data: {
          keys,
          hasMore: response.IsTruncated === true,
        },
      };
    } catch (err: unknown) {
      return { ok: false, error: classifyS3Error(err, "s3_list") };
    }
  }
}
