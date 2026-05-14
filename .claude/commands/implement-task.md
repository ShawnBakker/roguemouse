---
description: Execute an approved plan phase by phase, with hard gates between phases.
---

# /implement-task

Use this command to execute an approved implementation plan. The plan is the contract — deviations must be justified explicitly.

## What to do

1. Read `docs/sprints/[feature-name]/plan.md` in full. If it does not exist, stop and tell the operator to run `/plan-task` first.

2. Re-read `tasks/lessons.md`. Anti-patterns to avoid have not changed since `/plan-task`, but reading again keeps them fresh in context.

3. For each phase in the plan:
   a. **Re-read each target file immediately before editing it.** Do not rely on file contents read earlier in the session, even from earlier in this command. Context decay is real.
   b. Apply the changes specified in the plan, in the order specified.
   c. After completing all edits for the phase, run `pnpm -r typecheck`. If new errors appear (errors not present before this phase started), stop and report.
   d. Run any phase-specific tests called for in the plan.
   e. Report phase completion: which files changed, which acceptance criteria are now satisfied, any deviations from the plan with justification.
   f. **Stop and wait** for operator approval before starting the next phase.

## Hard rules — non-negotiable

1. **Read before edit.** Always re-read the target file immediately before editing. If you have read it earlier in the session, read it again now. Stale context causes subtle bugs.

2. **Typecheck between phases.** Run `pnpm -r typecheck` at the end of every phase. If new errors appear, stop. Do not fix pre-existing errors — the baseline error count must not increase, but it also should not decrease as a side effect of this work.

3. **Do not fix pre-existing test failures.** If a test was already failing when you started, it stays failing unless the plan explicitly addresses it. The baseline failure count must not increase.

4. **Do not push.** Never run `git push` during `/implement-task`. The operator pushes after `/review-task` passes.

5. **Do not commit without approval.** You may stage changes with `git add`, but do not run `git commit` until the operator explicitly says "commit" or after `/review-task` passes.

6. **Deviations require justification.** If you find that following the plan literally would produce broken or worse code, stop, explain the discrepancy, propose a deviation, and wait for operator approval. Do not silently improvise.

## Phase completion report

After each phase, produce this structured report:

```markdown
## Phase N — [phase name] complete

### Files changed
- `path/to/file.ts` (+N -M lines)
- `path/to/other.ts` (+N -M lines)

### Acceptance criteria satisfied by this phase
- AC-01: ✅ [how it's satisfied — quote lines that demonstrate this]
- AC-03: ✅ [how it's satisfied]
- AC-04: ⏳ Pending Phase 3

### Typecheck
- Baseline errors before phase: N
- Current errors after phase: N
- Verdict: PASS (no new errors) | FAIL (M new errors)

### Tests
- `pnpm smoke`: PASS
- `pnpm test --filter @roguemouse/agent`: PASS

### Deviations from plan
- None
  OR
- [exact deviation] because [reason]

### Next
Awaiting operator approval to proceed to Phase N+1.
```

## Final report

After all phases are complete:

```markdown
## Implementation complete

### Files changed (cumulative)
[full list]

### Acceptance criteria
- AC-01: ✅ [demonstrated by lines X-Y in file Z]
- AC-02: ✅ [demonstrated by lines X-Y in file Z]
- ...

### Deviations from plan
[summary, with justification]

### Ready for /review-task
Awaiting operator approval to begin review.
```

## Stop gate

Implementation does not push. Implementation does not commit without explicit instruction. After the final report, stop and wait for the operator to run `/review-task`.
