# Hackathon rules

## Submission constraints

- **Event**: AI Agent Olympics Hackathon · Milan AI Week 2026
- **Build window**: Wednesday May 13 – Tuesday May 19, 2026
- **Submission deadline**: **17:00 CEST · Tuesday, May 19, 2026** (08:00 PDT)
- **Internal target submission**: 20:00 PDT · Monday, May 18, 2026 (12-hour buffer)
- **Demo & Awards**: Wednesday, May 20 · Fiera Milano (Rho)

## Target tracks

Roguemouse is targeting two prize tracks simultaneously:

1. **Vultr "Best use of Vultr" Award** — $5,000 cash + $1,000 credits (1st place)
2. **Gemini track** — $5,000 cash (1st place)

Both tracks share the same submission. The architectural choices (Vultr Object Storage + Vultr Serverless Inference for Ops Engineer voice + Gemini for Risk Officer and Synthesizer) are designed to satisfy both judging panels.

**Not targeting**: Kraken, Featherless, Speechmatics. Don't add integrations for these even if you have time — sponsor stacking has diminishing returns and dilutes the architectural narrative.

## IP firewall — strict

Roguemouse is a fresh repo with original code. The following rules are non-negotiable:

1. **No code copied from Meridian** or any other private project. Domain expertise from Meridian informs design judgment (which failure modes are realistic, what runbook content looks like, how trading systems break). Source code does not cross the boundary.

2. **No file paths, function names, or identifiers from Meridian** appear in Roguemouse. If a Meridian utility happens to have the right shape, re-derive it from first principles with a different name.

3. **Git history starts May 13, 2026.** No backdated commits. No imports of historical code under a new commit message.

4. **All third-party dependencies must be MIT-, Apache-2.0-, or BSD-licensed.** No GPL, AGPL, SSPL. Generate `THIRD_PARTY_LICENSES.md` programmatically before submission.

5. **README discloses origin honestly**: Roguemouse was built from scratch within the hackathon window. Architectural patterns are inspired by the lead author's prior independent work, but no code was copied or ported.

## Required disclaimers

These must appear in the README and in the UI:

### "Methodology, not alpha" framing

> Roguemouse demonstrates audit-grade AI governance methodology for algorithmic trading. We are not a trader, not a strategy, and not a prediction service. We are the layer that makes any autonomous trader accountable to a human and to a regulator.

### "No real trades" disclaimer

> Roguemouse does not place real trades. The "broker" in this project is a deterministic mock that replays seeded fixtures. No live brokerage account is connected. No real money is at risk. The "anomalies" in the demo scenarios are synthetic and crafted for reproducibility.

### Audit integrity disclosure

> Roguemouse uses application-layer SHA-256 hash-chained audit records to detect tampering. Bucket-level immutability (S3 Object Lock) is not available on Vultr Object Storage, so tampering detection relies on the cryptographic chain rather than storage enforcement.

These are not weakness disclosures — they are credibility moves. Judges who know S3 well will respect the honesty; judges who don't will appreciate the clarity.

## Deliverables checklist

The lablab.ai submission form requires:

- [ ] Public GitHub repo URL (MIT-licensed)
- [ ] Demo video URL (≤ 3 minutes, hosted on YouTube unlisted is fine)
- [ ] Live application URL (deployed to Vultr VPS)
- [ ] Pitch deck URL (10–12 slides max)
- [ ] Cover image (1280×720, 16:9)
- [ ] Submission title (max 50 characters)
- [ ] Short description (max 255 characters)
- [ ] Long description (min 100 words)

## Track-tagging logic

Tag these tracks on the submission form:

- **Agentic Workflows** — non-negotiable; the planner orchestrates multi-step tool calls
- **Enterprise Utility** — non-negotiable; trading ops is enterprise
- **Intelligent Reasoning** — Risk Officer + Ops Engineer + Synthesizer is multi-step reasoning with re-planning
- **Collaborative Systems** — defensible; tag if multi-agent comes through clearly in the demo

**Skip**: Multimodal Intelligence (we don't process images/audio/video).

## Kill-switch checkpoints

These are decision points where we cut scope rather than ship broken:

- **End of Day 2 (Thursday May 14)**: If Tool Schema and Audit Schema are not locked, cut Vector Store RAG feature. Roguemouse can demo without RAG; it cannot demo without locked schemas.

- **End of Day 4 (Saturday May 16)**: If all three demo scenarios are not working on the deployed Vultr URL, drop Scenario C. Polish A and B. Two flawless scenarios beat three jittery ones.

- **End of Day 5 (Sunday May 17)**: Demo video must exist by 23:00 even if it's the "uglier" cut. Day 6 is for *improving* the video, not creating it.

If we miss a checkpoint, we cut. We do not extend the timeline.

## Quote countable artifacts in pitch

Competing projects (AutoResearch, ARIA, AI Trading Agents Harness) lean heavily on countable artifacts in their pitches. Roguemouse must do the same:

- 8 agent tools in the schema
- 3 deterministic demo scenarios
- ~120 audit log entries per scenario run (depending on tool-call depth)
- SHA-256 hash-chained, RFC 8785 canonical JSON
- 7-step governance pipeline (anomaly detection → tool dispatch → Risk Officer reasoning → Ops Engineer reasoning → Synthesizer reconciliation → human approval → audit commit)
- 0 autonomous mutations of trading-system state (every action requires human approval)
- 1 deliberate refusal moment (one scenario where the agent refuses to propose due to degraded inputs)

Specific numbers, not vague claims. Update these as the build evolves and the actual numbers solidify.

## Surface the rejection story

The most common judge question: "what if the AI is wrong?"

Build one of the three demo scenarios so the agent **explicitly refuses** to propose a remediation when its inputs are degraded (e.g., the Vector Store returns low-confidence chunks, or the Risk Officer's circuit breaker is open). The audit log captures the refusal with full reasoning.

This refusal moment is the highest-trust demo moment. Practice it. Frame it: "The audit log proves the system refuses to act when uncertain — not just that it acts when confident."
