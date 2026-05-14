---
description: Audit a completed implementation against its spec and the project's conventions.
---

# /review-task

Use this command to audit a completed implementation. The review is independent of the implementation — do not assume correctness, read the actual code.

## What to do

1. Read `docs/sprints/[feature-name]/spec.md` to understand what was supposed to be built.

2. Read `docs/sprints/[feature-name]/plan.md` to understand how it was supposed to be built.

3. **Read the actual code at every file the plan touched.** Do not trust the implementation report from `/implement-task` — the report could be wrong or incomplete. Independent verification is the entire point of this command.

4. For each acceptance criterion in the spec:
   - Find the exact lines of code that satisfy it
   - Quote those lines in the review
   - If you cannot find lines that satisfy it, mark it FAIL with the gap explained

5. Check for architectural violations not necessarily covered by acceptance criteria:
   - **New fail-open paths on agent-critical code?** Any new code that silently defaults to "permissive" behavior in error cases?
   - **Audit log integrity preserved?** Every new audit record write maintains the SHA-256 hash chain. No code path overwrites an existing record or breaks `previousHash` continuity.
   - **No throws inside LLM client code?** All `packages/inference/` code paths return `{ ok, error }` envelopes instead of throwing.
   - **No new Vercel-specific features?** No Edge runtime, no `next/image` optimization that requires Vercel, no `@vercel/*` imports.
   - **No code from Meridian or other prior projects?** All new code is original. Look for stylistic anomalies that suggest a paste from another codebase.
   - **Zod schemas updated in `packages/schemas`?** New tool inputs/outputs and audit record fields must be defined in the schemas package, not inline in calling code.

6. Check for issues outside the acceptance criteria scope. If you find bugs, security issues, or architectural drift, surface them in the review.

## Output

Write the review to `docs/sprints/[feature-name]/review.md`.

Document structure:

```markdown
# [Feature Name] — Review

## Acceptance criteria verdict

| AC | Verdict | Evidence |
|---|---|---|
| AC-01 | ✅ PASS | `path/file.ts:42-58` — [quoted lines showing satisfaction] |
| AC-02 | ✅ PASS | `path/other.ts:103-118` — [quoted lines] |
| AC-03 | ❌ FAIL | Spec requires X; code does Y instead at `path/file.ts:201` |
| AC-04 | ⚠️ PARTIAL | Implemented at `path/file.ts:67` but missing edge case from spec |

## Architectural review

### Fail-open paths
[None found, OR list with locations]

### Audit log integrity
[Preserved, OR list of records that break the chain]

### LLM client error handling
[All return structured errors, OR list of throws found]

### Vercel-specific features
[None found, OR list]

### Code provenance
[All original, OR suspicious patterns flagged]

### Schema discipline
[All new shapes in packages/schemas, OR inline schemas found]

## Issues found outside AC scope
- [issue]: [location, severity, suggested fix]
- [issue]: [location, severity, suggested fix]

## Overall verdict
[PASS — ready to push] | [PASS with caveats — push after addressing N issues] | [FAIL — must fix before push]
```

## Stop gate

After writing the review:
1. Report the file path
2. Summarize the overall verdict
3. Stop

Do not push. The operator pushes after reviewing the review and confirming verdict.
