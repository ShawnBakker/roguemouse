import { describe, expect, it } from "vitest";

import { synthesizerResponseSchema } from "../synthesizerResponseSchema.js";

const VALID_PROPOSAL = {
  decision: "proposal",
  confidence_bp: 7500,
  reasoning: "Risk Officer and Ops Engineer both flag the IV/RV breach with consistent signals.",
  proposal_text:
    "I recommend halving the AAPL position pending data-quality confirmation; the IV/RV ratio is meaningfully below the floor.",
  supporting_evidence: [
    { source: "risk_officer", claim: "IV/RV ratio 0.42 vs threshold 0.45" },
    { source: "ops_engineer", claim: "internal and broker positions agree" },
  ],
  expected_impact: { positionDeltaShares: -50, riskReduction: "moderate" },
};

const VALID_REFUSAL = {
  decision: "refusal",
  confidence_bp: 3500,
  reasoning: "Voices disagree on the operational impact; data confidence is insufficient.",
  refusal_reason_code: "inconsistent_voice_inputs",
  degraded_inputs: [
    { source: "broker_reconcile", reason: "60-share divergence between internal and broker views" },
  ],
};

describe("synthesizerResponseSchema — happy paths", () => {
  it("parses a valid full proposal-shape JSON", () => {
    const result = synthesizerResponseSchema.safeParse(VALID_PROPOSAL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision).toBe("proposal");
      if (result.data.decision === "proposal") {
        expect(result.data.confidence_bp).toBe(7500);
        expect(result.data.proposal_text).toContain("recommend");
        expect(result.data.supporting_evidence).toHaveLength(2);
      }
    }
  });

  it("parses a valid full refusal-shape JSON", () => {
    const result = synthesizerResponseSchema.safeParse(VALID_REFUSAL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision).toBe("refusal");
      if (result.data.decision === "refusal") {
        expect(result.data.refusal_reason_code).toBe("inconsistent_voice_inputs");
        expect(result.data.degraded_inputs).toHaveLength(1);
      }
    }
  });

  it("accepts empty supporting_evidence array (zero or more items)", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      supporting_evidence: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty degraded_inputs array", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_REFUSAL,
      degraded_inputs: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("synthesizerResponseSchema — confidence_bp constraints", () => {
  it("rejects negative confidence_bp", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      confidence_bp: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence_bp above 10000", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      confidence_bp: 15000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer confidence_bp", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      confidence_bp: 4500.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts confidence_bp exactly at the boundary (0)", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      confidence_bp: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts confidence_bp exactly at the boundary (10000)", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      confidence_bp: 10000,
    });
    expect(result.success).toBe(true);
  });
});

describe("synthesizerResponseSchema — decision field", () => {
  it("rejects missing decision field", () => {
    const { decision, ...rest } = VALID_PROPOSAL;
    void decision;
    const result = synthesizerResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid decision literal", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      decision: "uncertain",
    });
    expect(result.success).toBe(false);
  });
});

describe("synthesizerResponseSchema — string content", () => {
  it("rejects empty reasoning", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      reasoning: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty proposal_text", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      proposal_text: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty refusal_reason_code", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_REFUSAL,
      refusal_reason_code: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("synthesizerResponseSchema — branch discrimination", () => {
  it("rejects mixed-branch object (both proposal AND refusal fields)", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      refusal_reason_code: "should_not_be_here",
      degraded_inputs: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects proposal branch missing supporting_evidence", () => {
    const { supporting_evidence, ...rest } = VALID_PROPOSAL;
    void supporting_evidence;
    const result = synthesizerResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects refusal branch missing degraded_inputs", () => {
    const { degraded_inputs, ...rest } = VALID_REFUSAL;
    void degraded_inputs;
    const result = synthesizerResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("synthesizerResponseSchema — nested item validation", () => {
  it("rejects malformed supporting_evidence (missing claim)", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      supporting_evidence: [{ source: "risk_officer" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed supporting_evidence (empty source)", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_PROPOSAL,
      supporting_evidence: [{ source: "", claim: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed degraded_inputs (missing reason)", () => {
    const result = synthesizerResponseSchema.safeParse({
      ...VALID_REFUSAL,
      degraded_inputs: [{ source: "broker_reconcile" }],
    });
    expect(result.success).toBe(false);
  });
});
