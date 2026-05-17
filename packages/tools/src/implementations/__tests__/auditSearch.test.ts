import type { ReadResult } from "@roguemouse/audit";

import { describe, expect, it } from "vitest";

import { auditSearch } from "../auditSearch.js";
import { makeCtx, makeFakeWriter } from "./testHelpers.js";

const GENESIS = "b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc";

function validRecord(opts: {
  ts: string;
  recordType: "smoke_test:chat_completion";
  runId?: string;
}): unknown {
  return {
    ts: opts.ts,
    runId: opts.runId ?? "test-run",
    recordType: opts.recordType,
    previousHash: GENESIS,
    payload: {
      model: "test-model",
      prompt: "p",
      response: "c",
      tokens: { prompt: 1, completion: 1, total: 2 },
      durationMs: 1,
    },
  };
}

function readSuccess(key: string, parsed: unknown): ReadResult {
  return {
    ok: true,
    data: { key, body: JSON.stringify(parsed), parsed },
  };
}

describe("auditSearch", () => {
  it("returns parsed records for keys returned by writer.list", async () => {
    const r1 = validRecord({
      ts: "2026-05-16T10:00:00.000Z",
      recordType: "smoke_test:chat_completion",
    });
    const r2 = validRecord({
      ts: "2026-05-16T11:00:00.000Z",
      recordType: "smoke_test:chat_completion",
    });
    const fake = makeFakeWriter({
      listResponses: [
        {
          ok: true,
          data: {
            keys: ["audit/test-run/k1.json", "audit/test-run/k2.json"],
            hasMore: false,
          },
        },
      ],
      readResponses: new Map([
        ["audit/test-run/k1.json", readSuccess("audit/test-run/k1.json", r1)],
        ["audit/test-run/k2.json", readSuccess("audit/test-run/k2.json", r2)],
      ]),
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditSearch({ runId: "test-run", limit: 10 }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.records).toHaveLength(2);
      expect(result.data.hasMore).toBe(false);
    }
    expect(fake.listCalls[0]?.runIdPrefix).toBe("test-run");
    expect(fake.listCalls[0]?.limit).toBe(10);
  });

  it("SKIPS keys whose writer.read fails (does not abort the whole search)", async () => {
    const r2 = validRecord({
      ts: "2026-05-16T11:00:00.000Z",
      recordType: "smoke_test:chat_completion",
    });
    const fake = makeFakeWriter({
      listResponses: [
        {
          ok: true,
          data: {
            keys: ["audit/test-run/k1.json", "audit/test-run/k2.json"],
            hasMore: false,
          },
        },
      ],
      readResponses: new Map<string, ReadResult>([
        [
          "audit/test-run/k1.json",
          {
            ok: false,
            error: { code: "NoSuchKey", message: "gone", retryable: false, step: "s3_get" },
          },
        ],
        ["audit/test-run/k2.json", readSuccess("audit/test-run/k2.json", r2)],
      ]),
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditSearch({ runId: "test-run", limit: 10 }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.records).toHaveLength(1);
      expect(result.data.records[0]?.ts).toBe("2026-05-16T11:00:00.000Z");
    }
  });

  it("skips records whose JSON fails auditRecordBodySchema validation", async () => {
    const fake = makeFakeWriter({
      listResponses: [
        {
          ok: true,
          data: { keys: ["audit/test-run/bad.json"], hasMore: false },
        },
      ],
      readResponses: new Map([
        [
          "audit/test-run/bad.json",
          readSuccess("audit/test-run/bad.json", { not: "a valid record" }),
        ],
      ]),
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditSearch({ runId: "test-run", limit: 10 }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.records).toEqual([]);
    }
  });

  it("filters by recordType when provided", async () => {
    const matching = validRecord({
      ts: "2026-05-16T10:00:00.000Z",
      recordType: "smoke_test:chat_completion",
    });
    const fake = makeFakeWriter({
      listResponses: [
        {
          ok: true,
          data: { keys: ["audit/test-run/k1.json"], hasMore: false },
        },
      ],
      readResponses: new Map([
        ["audit/test-run/k1.json", readSuccess("audit/test-run/k1.json", matching)],
      ]),
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditSearch(
      { runId: "test-run", recordType: "anomaly:detected", limit: 10 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.records).toEqual([]);
    }
  });

  it("filters by sinceTs (excludes records older than the threshold)", async () => {
    const old = validRecord({
      ts: "2026-05-16T08:00:00.000Z",
      recordType: "smoke_test:chat_completion",
    });
    const fresh = validRecord({
      ts: "2026-05-16T12:00:00.000Z",
      recordType: "smoke_test:chat_completion",
    });
    const fake = makeFakeWriter({
      listResponses: [
        {
          ok: true,
          data: {
            keys: ["audit/test-run/old.json", "audit/test-run/fresh.json"],
            hasMore: false,
          },
        },
      ],
      readResponses: new Map([
        ["audit/test-run/old.json", readSuccess("audit/test-run/old.json", old)],
        ["audit/test-run/fresh.json", readSuccess("audit/test-run/fresh.json", fresh)],
      ]),
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditSearch(
      {
        runId: "test-run",
        sinceTs: "2026-05-16T10:00:00.000Z",
        limit: 10,
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.records).toHaveLength(1);
      expect(result.data.records[0]?.ts).toBe("2026-05-16T12:00:00.000Z");
    }
  });

  it("returns hasMore=true reflecting the LIST response, NOT the post-filter count", async () => {
    const r = validRecord({
      ts: "2026-05-16T10:00:00.000Z",
      recordType: "smoke_test:chat_completion",
    });
    const fake = makeFakeWriter({
      listResponses: [
        {
          ok: true,
          data: { keys: ["audit/test-run/k1.json"], hasMore: true },
        },
      ],
      readResponses: new Map([
        ["audit/test-run/k1.json", readSuccess("audit/test-run/k1.json", r)],
      ]),
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditSearch(
      { runId: "test-run", recordType: "anomaly:detected", limit: 10 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.records).toEqual([]);
      expect(result.data.hasMore).toBe(true);
    }
  });

  it("propagates writer.list envelope error preserving code/step", async () => {
    const fake = makeFakeWriter({
      listResponses: [
        {
          ok: false,
          error: {
            code: "AccessDenied",
            message: "forbidden",
            retryable: false,
            step: "s3_list",
          },
        },
      ],
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditSearch({ runId: "test-run", limit: 10 }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AccessDenied");
      expect(result.error.step).toBe("s3_list");
    }
  });
});
