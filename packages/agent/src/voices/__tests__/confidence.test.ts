import { describe, expect, it } from "vitest";

import {
  RISK_OPS_PLACEHOLDER_CONFIDENCE_BP,
  SYNTHESIZER_CONFIDENCE_THRESHOLD_BP,
  parseSynthesizerResponse,
  resolveTerminalDecision,
} from "../confidence.js";
import type { SynthesizerResponse } from "../synthesizerResponseSchema.js";

const VALID_PROPOSAL_JSON = JSON.stringify({
  decision: "proposal",
  confidence_bp: 7500,
  reasoning: "Voices agree; data is clean.",
  proposal_text: "I recommend halving the AAPL position pending verification.",
  supporting_evidence: [
    { source: "risk_officer", claim: "ratio below floor" },
    { source: "ops_engineer", claim: "positions match broker" },
  ],
  expected_impact: { positionDeltaShares: -50 },
});

const VALID_REFUSAL_JSON = JSON.stringify({
  decision: "refusal",
  confidence_bp: 3500,
  reasoning: "Voice perspectives disagree on operational impact.",
  refusal_reason_code: "inconsistent_voice_inputs",
  degraded_inputs: [
    { source: "broker_reconcile", reason: "60-share divergence" },
  ],
});

describe("constants", () => {
  it("RISK_OPS_PLACEHOLDER_CONFIDENCE_BP is 5000", () => {
    expect(RISK_OPS_PLACEHOLDER_CONFIDENCE_BP).toBe(5000);
  });

  it("SYNTHESIZER_CONFIDENCE_THRESHOLD_BP is 4500", () => {
    expect(SYNTHESIZER_CONFIDENCE_THRESHOLD_BP).toBe(4500);
  });
});

describe("parseSynthesizerResponse — happy paths", () => {
  it("parses a valid proposal-shape JSON string", () => {
    const result = parseSynthesizerResponse(VALID_PROPOSAL_JSON);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.decision).toBe("proposal");
      expect(result.response.confidence_bp).toBe(7500);
    }
  });

  it("parses a valid refusal-shape JSON string", () => {
    const result = parseSynthesizerResponse(VALID_REFUSAL_JSON);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.decision).toBe("refusal");
      if (result.response.decision === "refusal") {
        expect(result.response.refusal_reason_code).toBe(
          "inconsistent_voice_inputs",
        );
      }
    }
  });
});

describe("parseSynthesizerResponse — JSON parse failure", () => {
  it("returns ok:false with synthesizer_malformed_response on invalid JSON", () => {
    const result = parseSynthesizerResponse("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("synthesizer_malformed_response");
      expect(result.degradedInputs).toHaveLength(1);
      expect(result.degradedInputs[0]?.source).toBe("synthesizer_response");
      expect(result.degradedInputs[0]?.reason).toContain("JSON.parse failed");
    }
  });

  it("returns ok:false on empty string", () => {
    const result = parseSynthesizerResponse("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("synthesizer_malformed_response");
    }
  });
});

describe("parseSynthesizerResponse — schema validation failure", () => {
  it("returns ok:false on valid JSON with wrong shape", () => {
    const result = parseSynthesizerResponse(
      JSON.stringify({ not: "a synthesizer response" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("synthesizer_malformed_response");
      expect(result.degradedInputs[0]?.reason).toContain(
        "schema validation failed",
      );
    }
  });

  it("returns ok:false on confidence_bp out of range", () => {
    const malformed = JSON.stringify({
      decision: "proposal",
      confidence_bp: 15000,
      reasoning: "x",
      proposal_text: "x",
      supporting_evidence: [],
      expected_impact: {},
    });
    const result = parseSynthesizerResponse(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("synthesizer_malformed_response");
      expect(result.degradedInputs[0]?.reason).toContain("confidence_bp");
    }
  });
});

describe("resolveTerminalDecision", () => {
  function proposal(bp: number): SynthesizerResponse {
    return {
      decision: "proposal",
      confidence_bp: bp,
      reasoning: "x",
      proposal_text: "x",
      supporting_evidence: [],
      expected_impact: {},
    };
  }
  function refusal(bp: number): SynthesizerResponse {
    return {
      decision: "refusal",
      confidence_bp: bp,
      reasoning: "x",
      refusal_reason_code: "x",
      degraded_inputs: [],
    };
  }

  it("returns 'proposal' for decision=proposal at exactly 4500 (>=, not >)", () => {
    expect(resolveTerminalDecision(proposal(4500))).toBe("proposal");
  });

  it("returns 'refusal' for decision=proposal at 4499 (threshold override)", () => {
    expect(resolveTerminalDecision(proposal(4499))).toBe("refusal");
  });

  it("returns 'refusal' for decision=refusal at 9999 (respects model)", () => {
    expect(resolveTerminalDecision(refusal(9999))).toBe("refusal");
  });

  it("returns 'refusal' for decision=proposal at 0", () => {
    expect(resolveTerminalDecision(proposal(0))).toBe("refusal");
  });

  it("returns 'proposal' for decision=proposal at 10000 (max)", () => {
    expect(resolveTerminalDecision(proposal(10000))).toBe("proposal");
  });

  it("returns 'refusal' for decision=refusal at 0", () => {
    expect(resolveTerminalDecision(refusal(0))).toBe("refusal");
  });
});
