# Todo (parking lot)

This file captures ideas, improvements, and bugs noticed during current work but **not in scope** for the current sprint.

The rule: when you notice something worth fixing that's outside the current task's scope, write it here and move on. Never refactor opportunistically.

---

## Entry template

```markdown
## YYYY-MM-DD — Short title

[1–2 sentences describing the issue or improvement]

File(s): path/to/file.ts, path/to/other.ts
Priority: low | medium | high
Surfaced during: [feature name or context where this was noticed]
```

---

## 2026-05-14 — Pre-submission documentation sweep for "Meridian" references

Before submitting to lablab.ai, do a final grep across the entire repo for any reference to "Meridian" and rephrase to generic terms ("a prior internal project", "prior independent work") for consistency with the README's IP-firewall framing. Current known references:

- `.claude/rules/hackathon.md` (multiple) — IP firewall rule definitions
- `.claude/commands/review-task.md` — review template
- `CLAUDE.md` — project index
- `docs/sprints/workspace-scaffold/spec-and-plan.md` — AC-10 text and final verification checklist

These are all policy text describing what is forbidden, not code carry-over. AC-10's intent (no provenance leak in shipped code) is satisfied. The sweep is cosmetic — making the public repo's grep output match the README's framing.

File(s): see list above
Priority: low
Surfaced during: Sprint 1 /review-task

---

## 2026-05-14 — RFC 8785 canonicalization migration trigger

The rolled-own canonicalizer at `packages/audit/src/canonicalize.ts` handles JSON-safe values restricted per `packages/schemas/src/canonicalSafe.ts` (no floats, integers in safe range, no NFC requirement on strings). This is correct for Sprint 2-4 payloads. Migrate to an MIT-licensed RFC 8785 implementation (e.g., `canonicalize` on npm if license-compatible) if any of the following becomes a requirement:

- Audit payloads contain floating-point numbers
- Audit payloads contain integers beyond JavaScript's safe-integer range
- Hash verification must round-trip across non-NFC Unicode strings
- We need to interoperate with non-JS verifiers (Python, Rust, Go) that expect RFC 8785 byte-identical canonical form

File(s): packages/audit/src/canonicalize.ts, packages/schemas/src/canonicalSafe.ts
Priority: low (deferred — no current trigger)
Surfaced during: Sprint 2 brainstorm decision 3, locked at /spec-task

---

## 2026-05-17 — Sprint 7 polish: consider parallel tool dispatch with audit-write queue

Sprint 4b's dispatcher is serial: each `dispatchTool` call writes `tool:call` → executes body → writes `tool:result` before the next call begins. Sprint 4b's brainstorm Decision 1 considered a queued-parallel alternative (~40-line FIFO queue helper, ~2× latency improvement for 3-tool fan-out) but kept serial for correctness-first risk management in the highest-risk sprint.

If Sprint 4c reveals that the planner fans out reads (e.g., the Risk Officer voice calls 3 tools at the start of a debate step) and the resulting demo-time latency is visibly slow (~30-60 second runs are the worry), Sprint 7 polish should add the queue.

Implementation reference: `docs/sprints/dispatch-runtime-tools-rag/brainstorm.md` Decision 1, Approach 1B. The queue is a per-writer FIFO that serializes `safeParse → canonicalize → hash → S3 PUT` cycles while letting tool bodies execute in parallel via `Promise.all`. Chain ordering is preserved deterministically.

Trigger conditions:
- Sprint 4c's planner produces measurable fan-out latency (>5 seconds wall-clock spent on serial S3 PUTs).
- Demo viewers visibly wait during a scenario run.
- A Sprint 4b retrospective identifies serial dispatch as the bottleneck.

If none of the above is observed, leave the dispatcher serial.

**Empirical data from Sprint 4b Phase 6 smoke (2026-05-17)**: serial dispatch costs ~300ms per S3 round trip (2 writes per dispatch). For Sprint 4c's ~120-record Scenario A run, this compounds to ~36 seconds of S3 overhead alone. Queued parallel would shave significantly. If Sprint 4c's demo latency is visibly slow, this becomes a viable Sprint 7 priority. RunId for reference: 2bae8eaa-1553-4d5a-bd02-8f15a3cb82db.

File(s): packages/agent/src/dispatcher.ts
Priority: low (deferred — no current trigger, but easy to add if needed)
Surfaced during: Sprint 4b brainstorm Decision 1 (operator kept 1A over my reversal to 1B)

---

## 2026-05-17 — Audit shared primitives in @roguemouse/schemas for promotion to public barrel exports

As more code outside the schemas package needs internal constants (`ISO_TIMESTAMP_MS_REGEX` is the first; Sprint 4b's fixture loader in `packages/tools/src/fixtures/scenarioASchema.ts` currently duplicates it as a 1-line constant), the duplication-vs-public-API trade tilts toward making `primitives.ts` constants public via the schemas barrel. Candidates: `ISO_TIMESTAMP_MS_REGEX`, `HEX_64_REGEX`, `TOOL_NAME_LITERALS`. Sprint 7 polish or post-submission.

File(s): packages/schemas/src/index.ts, packages/schemas/src/primitives.ts
Priority: low
Surfaced during: Sprint 4b Phase 1 deviation 4

---

## 2026-05-17 — Normalize runbook paths to POSIX-style forward slashes

`loadRunbookCorpus` currently returns paths built via `path.join`, which produces Windows-style backslashes on Windows hosts (e.g., `packages\\runbooks\\content\\iv-rv-divergence.md`). Functional on the dev host but inconsistent across platforms. The path is informational only (not used as a programmatic identifier or filesystem key), so impact is cosmetic. Switching to `path.posix.join` or a final `replaceAll("\\", "/")` would normalize. Sprint 7 polish or post-submission.

File(s): packages/runbooks/src/loader.ts
Priority: low
Surfaced during: Sprint 4b Phase 2 manual verification
