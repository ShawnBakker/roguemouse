import {
  ListObjectsV2Command,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";

import { describe, expect, it } from "vitest";

import { RunAuditWriter } from "./runAuditWriter.js";

const BUCKET = "roguemouse-audit-log";

type ListResponse = {
  Contents?: Array<{ Key?: string }>;
  IsTruncated?: boolean;
};

/**
 * Hand-rolled S3 client fake. The writer only calls `.send(command)`;
 * this fake captures every command it receives and returns a stubbed
 * response (or throws a stubbed error) selected by the command type.
 *
 * The cast through `unknown` is necessary because the full `S3Client`
 * interface is large and we only need the `.send` shape for these tests.
 */
function makeFakeS3({
  listResponse,
  listError,
}: {
  listResponse?: ListResponse;
  listError?: unknown;
}): { client: S3Client; sentCommands: ListObjectsV2Command[] } {
  const sentCommands: ListObjectsV2Command[] = [];
  const fake = {
    async send(command: unknown): Promise<unknown> {
      if (command instanceof ListObjectsV2Command) {
        sentCommands.push(command);
        if (listError !== undefined) throw listError;
        return listResponse ?? { Contents: [], IsTruncated: false };
      }
      throw new Error(`unexpected command sent to fake S3 client: ${command}`);
    },
  };
  return { client: fake as unknown as S3Client, sentCommands };
}

function makeWriter(s3Client: S3Client): RunAuditWriter {
  return new RunAuditWriter({
    s3Client,
    bucket: BUCKET,
    runId: "test-run-id",
    canonicalize: (v) => JSON.stringify(v),
    sha256Hex: () => "0".repeat(64),
  });
}

describe("RunAuditWriter#list", () => {
  it("uses prefix audit/{runIdPrefix}/ when runIdPrefix is provided", async () => {
    const { client, sentCommands } = makeFakeS3({
      listResponse: { Contents: [], IsTruncated: false },
    });
    const writer = makeWriter(client);

    const result = await writer.list({ runIdPrefix: "abc-123" });

    expect(result.ok).toBe(true);
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0]!.input.Prefix).toBe("audit/abc-123/");
    expect(sentCommands[0]!.input.Bucket).toBe(BUCKET);
  });

  it("uses prefix audit/ when runIdPrefix is omitted", async () => {
    const { client, sentCommands } = makeFakeS3({
      listResponse: { Contents: [], IsTruncated: false },
    });
    const writer = makeWriter(client);

    await writer.list({});

    expect(sentCommands[0]!.input.Prefix).toBe("audit/");
  });

  it("returns keys: [] and hasMore: false when Contents is undefined", async () => {
    const { client } = makeFakeS3({
      listResponse: { Contents: undefined, IsTruncated: false },
    });
    const writer = makeWriter(client);

    const result = await writer.list({ runIdPrefix: "x" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keys).toEqual([]);
      expect(result.data.hasMore).toBe(false);
    }
  });

  it("returns hasMore: true when S3 reports IsTruncated: true", async () => {
    const { client } = makeFakeS3({
      listResponse: {
        Contents: [{ Key: "audit/x/2026-05-16T00-00-00.000Z-abc.json" }],
        IsTruncated: true,
      },
    });
    const writer = makeWriter(client);

    const result = await writer.list({ runIdPrefix: "x" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hasMore).toBe(true);
      expect(result.data.keys).toEqual([
        "audit/x/2026-05-16T00-00-00.000Z-abc.json",
      ]);
    }
  });

  it("passes MaxKeys=limit when limit is provided", async () => {
    const { client, sentCommands } = makeFakeS3({
      listResponse: { Contents: [], IsTruncated: false },
    });
    const writer = makeWriter(client);

    await writer.list({ runIdPrefix: "x", limit: 50 });

    expect(sentCommands[0]!.input.MaxKeys).toBe(50);
  });

  it("defaults MaxKeys to 100 when limit is omitted", async () => {
    const { client, sentCommands } = makeFakeS3({
      listResponse: { Contents: [], IsTruncated: false },
    });
    const writer = makeWriter(client);

    await writer.list({ runIdPrefix: "x" });

    expect(sentCommands[0]!.input.MaxKeys).toBe(100);
  });

  it("filters out Contents entries with missing or non-string Key", async () => {
    const { client } = makeFakeS3({
      listResponse: {
        Contents: [
          { Key: "audit/x/a.json" },
          { Key: undefined },
          {},
          { Key: "audit/x/b.json" },
        ],
        IsTruncated: false,
      },
    });
    const writer = makeWriter(client);

    const result = await writer.list({ runIdPrefix: "x" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keys).toEqual(["audit/x/a.json", "audit/x/b.json"]);
    }
  });

  it("returns an envelope error with step: s3_list on HTTP 403 (non-retryable)", async () => {
    const error = new S3ServiceException({
      name: "AccessDenied",
      $fault: "client",
      $metadata: { httpStatusCode: 403 },
      message: "Access Denied",
    });
    const { client } = makeFakeS3({ listError: error });
    const writer = makeWriter(client);

    const result = await writer.list({ runIdPrefix: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.step).toBe("s3_list");
      expect(result.error.retryable).toBe(false);
      expect(result.error.code).toBe("AccessDenied");
    }
  });

  it("returns an envelope error with step: s3_list and retryable=true on HTTP 503", async () => {
    const error = new S3ServiceException({
      name: "ServiceUnavailable",
      $fault: "server",
      $metadata: { httpStatusCode: 503 },
      message: "Service Unavailable",
    });
    const { client } = makeFakeS3({ listError: error });
    const writer = makeWriter(client);

    const result = await writer.list({ runIdPrefix: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.step).toBe("s3_list");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("returns retryable=true for ECONNRESET network errors", async () => {
    const error = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    const { client } = makeFakeS3({ listError: error });
    const writer = makeWriter(client);

    const result = await writer.list({ runIdPrefix: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.step).toBe("s3_list");
      expect(result.error.retryable).toBe(true);
      expect(result.error.code).toBe("ECONNRESET");
    }
  });
});
