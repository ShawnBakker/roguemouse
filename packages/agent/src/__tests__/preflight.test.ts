import { OpenAI } from "openai";

import { describe, expect, it } from "vitest";

import { vultrNemotronPreflight } from "../preflight.js";

const MODEL = "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16";

type FakeResponse = {
  choices: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

/**
 * Hand-rolled fake OpenAI client. The chatCompletion function calls
 * `client.chat.completions.create(...)`; this fake captures the call
 * args and returns a stubbed response or throws a stubbed error.
 * Same pattern as Sprint 4b's fake writers — cast through unknown
 * because the full OpenAI interface is large and we only need the
 * one method.
 */
function makeFakeClient(opts: {
  response?: FakeResponse;
  throwError?: unknown;
}): { client: OpenAI; sentArgs: Array<{ model: string; max_tokens: number }> } {
  const sentArgs: Array<{ model: string; max_tokens: number }> = [];
  const fake = {
    chat: {
      completions: {
        async create(args: { model: string; max_tokens: number }): Promise<FakeResponse> {
          sentArgs.push({ model: args.model, max_tokens: args.max_tokens });
          if (opts.throwError !== undefined) {
            throw opts.throwError;
          }
          if (opts.response) {
            return opts.response;
          }
          throw new Error("fake client misconfigured: no response or error");
        },
      },
    },
  };
  return { client: fake as unknown as OpenAI, sentArgs };
}

const HAPPY_RESPONSE: FakeResponse = {
  choices: [
    { message: { content: "OK" }, finish_reason: "stop" },
  ],
  model: MODEL,
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
};

const EMPTY_CONTENT_RESPONSE: FakeResponse = {
  choices: [
    { message: { content: "" }, finish_reason: "stop" },
  ],
  model: MODEL,
  usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
};

describe("vultrNemotronPreflight", () => {
  it("returns ok: true when the model responds with content", async () => {
    const { client, sentArgs } = makeFakeClient({ response: HAPPY_RESPONSE });
    const result = await vultrNemotronPreflight(client, MODEL);
    expect(result.ok).toBe(true);
    expect(sentArgs).toHaveLength(1);
    expect(sentArgs[0]?.model).toBe(MODEL);
    expect(sentArgs[0]?.max_tokens).toBe(2000);
  });

  it("returns ok: false with HTTP 404 surfaced and remediation naming the model", async () => {
    const error = new OpenAI.APIError(
      404,
      { error: { message: "model not found" } },
      "model not found",
      undefined,
    );
    const { client } = makeFakeClient({ throwError: error });
    const result = await vultrNemotronPreflight(client, MODEL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toMatch(/^(http_404|.*not_found.*)$/);
      expect(result.message).toContain("model not found");
      expect(result.remediation).toContain(MODEL);
      expect(result.remediation).toContain("/v1/models");
    }
  });

  it("returns ok: false with HTTP 401 (auth)", async () => {
    const error = new OpenAI.APIError(
      401,
      { error: { message: "invalid api key" } },
      "invalid api key",
      undefined,
    );
    const { client } = makeFakeClient({ throwError: error });
    const result = await vultrNemotronPreflight(client, MODEL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.remediation).toContain("VULTR_INFERENCE_API_KEY");
    }
  });

  it("returns ok: false with HTTP 403 (forbidden)", async () => {
    const error = new OpenAI.APIError(
      403,
      { error: { message: "forbidden" } },
      "forbidden",
      undefined,
    );
    const { client } = makeFakeClient({ throwError: error });
    const result = await vultrNemotronPreflight(client, MODEL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("forbidden");
      expect(result.remediation).toContain(MODEL);
    }
  });

  it("returns ok: false on ECONNRESET network error (pre-flight hard-fails per AC-29)", async () => {
    const error = Object.assign(new Error("connection reset by peer"), {
      code: "ECONNRESET",
    });
    const { client } = makeFakeClient({ throwError: error });
    const result = await vultrNemotronPreflight(client, MODEL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ECONNRESET");
      expect(result.remediation).toContain(MODEL);
    }
  });

  it("returns ok: false when the model responds with empty content", async () => {
    const { client } = makeFakeClient({ response: EMPTY_CONTENT_RESPONSE });
    const result = await vultrNemotronPreflight(client, MODEL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("empty_response");
      expect(result.remediation).toContain(MODEL);
    }
  });

  it("returns ok: false on HTTP 500 (server error; retryable at classifier but hard-fails pre-flight)", async () => {
    const error = new OpenAI.APIError(
      500,
      { error: { message: "internal server error" } },
      "internal server error",
      undefined,
    );
    const { client } = makeFakeClient({ throwError: error });
    const result = await vultrNemotronPreflight(client, MODEL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Per AC-29: hard-fail regardless of retryable flag at classifier level.
      expect(result.remediation).toContain(MODEL);
    }
  });
});
