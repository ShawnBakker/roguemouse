import { describe, expect, it } from "vitest";

import { auditAppend } from "../auditAppend.js";
import { makeCtx, makeFakeWriter } from "./testHelpers.js";

describe("auditAppend", () => {
  it("calls writer.append for non-reserved recordTypes and returns key/hash/previousHash", async () => {
    const fake = makeFakeWriter();
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditAppend(
      {
        recordType: "anomaly:detected",
        payload: { anomalyId: "x", symbol: "AAPL" },
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(fake.appendCalls).toHaveLength(1);
    if (result.ok) {
      expect(result.data.key).toBeTypeOf("string");
      expect(result.data.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.data.previousHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("REJECTS recordType 'tool:call' with recordtype_reserved_for_dispatcher and DOES NOT call writer.append", async () => {
    const fake = makeFakeWriter();
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditAppend(
      {
        recordType: "tool:call",
        payload: { toolName: "market_data:lookup", invocationId: "x", args: {} },
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("recordtype_reserved_for_dispatcher");
      expect(result.error.retryable).toBe(false);
      expect(result.error.step).toBe("validate");
      expect(result.error.message).toMatch(/tool:call/);
    }
    expect(fake.appendCalls).toHaveLength(0);
  });

  it("REJECTS recordType 'tool:result' with recordtype_reserved_for_dispatcher and DOES NOT call writer.append", async () => {
    const fake = makeFakeWriter();
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditAppend(
      {
        recordType: "tool:result",
        payload: { toolName: "market_data:lookup", invocationId: "x", result: { ok: true, data: {} }, durationMs: 0 },
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("recordtype_reserved_for_dispatcher");
    }
    expect(fake.appendCalls).toHaveLength(0);
  });

  it("propagates writer.append envelope error preserving code/retryable/step", async () => {
    const fake = makeFakeWriter({
      appendResponses: [
        {
          ok: false,
          error: {
            code: "AccessDenied",
            message: "forbidden",
            retryable: false,
            step: "s3_put",
          },
        },
      ],
    });
    const ctx = makeCtx({ writer: fake.writer });

    const result = await auditAppend(
      {
        recordType: "anomaly:detected",
        payload: { anomalyId: "x", symbol: "AAPL" },
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AccessDenied");
      expect(result.error.retryable).toBe(false);
      expect(result.error.step).toBe("s3_put");
    }
  });
});
