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
