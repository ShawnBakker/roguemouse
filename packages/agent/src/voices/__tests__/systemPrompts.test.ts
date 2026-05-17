import { describe, expect, it } from "vitest";

import {
  OPS_ENGINEER_SYSTEM_PROMPT,
  RISK_OFFICER_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
} from "../systemPrompts.js";

const ALL_PROMPTS: ReadonlyArray<[string, string]> = [
  ["RISK_OFFICER_SYSTEM_PROMPT", RISK_OFFICER_SYSTEM_PROMPT],
  ["OPS_ENGINEER_SYSTEM_PROMPT", OPS_ENGINEER_SYSTEM_PROMPT],
  ["SYNTHESIZER_SYSTEM_PROMPT", SYNTHESIZER_SYSTEM_PROMPT],
];

describe("AC-16a substring checks: each prompt contains 'advise' OR 'recommend'", () => {
  for (const [name, prompt] of ALL_PROMPTS) {
    it(`${name} contains 'advise' or 'recommend'`, () => {
      const lower = prompt.toLowerCase();
      expect(lower.includes("advise") || lower.includes("recommend")).toBe(true);
    });
  }
});

describe("AC-16a substring checks: each prompt contains 'audit'", () => {
  for (const [name, prompt] of ALL_PROMPTS) {
    it(`${name} contains 'audit'`, () => {
      expect(prompt.toLowerCase().includes("audit")).toBe(true);
    });
  }
});

describe("AC-16a substring checks: no prompt contains executable action language", () => {
  for (const [name, prompt] of ALL_PROMPTS) {
    it(`${name} does NOT contain 'execute trade'`, () => {
      expect(prompt.toLowerCase().includes("execute trade")).toBe(false);
    });
    it(`${name} does NOT contain 'execute the trade'`, () => {
      expect(prompt.toLowerCase().includes("execute the trade")).toBe(false);
    });
    it(`${name} does NOT contain 'mutate state'`, () => {
      expect(prompt.toLowerCase().includes("mutate state")).toBe(false);
    });
  }
});

describe("Sanity: each system prompt is non-empty and in a reasonable size range", () => {
  for (const [name, prompt] of ALL_PROMPTS) {
    it(`${name} is between 200 and 3000 characters`, () => {
      expect(prompt.length).toBeGreaterThanOrEqual(200);
      expect(prompt.length).toBeLessThanOrEqual(3000);
    });
  }
});
