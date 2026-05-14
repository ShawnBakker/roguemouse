---
description: Write the functional specification for a feature based on an approved brainstorm.
---

# /spec-task

Use this command to convert an approved brainstorm into a precise functional specification. The spec describes **what** the system must do, not **how** to build it. Implementation details belong in `/plan-task`.

## What to do

1. Read `docs/sprints/[feature-name]/brainstorm.md` in full. If it does not exist, stop and tell the operator to run `/brainstorm` first.

2. Read all decisions the operator has communicated since the brainstorm. These decisions resolve open questions from the brainstorm and lock the approach being specified.

3. Write the spec. It must cover:

   - **Acceptance criteria**: numbered (AC-01, AC-02, …), each one binary pass/fail, each one independently testable. Avoid criteria that combine multiple assertions ("The agent responds within 5s AND produces valid JSON" is two criteria, not one).
   - **Data flow**: every new audit record type, every new Zod schema, every new field added to an existing schema. For changes to the audit log, specify how the SHA-256 hash chain remains intact.
   - **Edge cases**: enumerated, with the explicit handling for each. "What happens when the LLM returns invalid JSON?" must have a documented answer.
   - **Out of scope**: bullet list of things this feature deliberately does not address, with brief justification.
   - **Rollback plan**: per phase, how to revert if the change causes problems in production. For audit-log-touching changes, the rollback must preserve the existing hash chain.

4. The spec must not contain implementation details. No file paths, no function signatures, no library names beyond what the brainstorm locked in. If you find yourself writing "we will create a `parseFooBar` function in `packages/agent/src/foo.ts`", stop — that belongs in the plan.

## Output

Write the spec to `docs/sprints/[feature-name]/spec.md`.

Document structure:

```markdown
# [Feature Name] — Spec

## Summary
[1 paragraph]

## Acceptance criteria
- **AC-01**: [binary, testable assertion]
- **AC-02**: [binary, testable assertion]
- ...

## Data flow
[For each new schema or audit record type, describe shape and lifecycle]

## Edge cases
- **Case**: [description]
  **Handling**: [exact behavior]
- **Case**: [description]
  **Handling**: [exact behavior]

## Out of scope
- [item] — [brief justification]
- [item] — [brief justification]

## Rollback plan
- **Phase 1**: [how to revert]
- **Phase 2**: [how to revert]
- ...
```

## Stop gate

When the spec is complete:
1. Report the file path
2. Summarize the acceptance criteria count and any edge cases the operator should pay particular attention to
3. Stop

Do not proceed to `/plan-task`. Wait for explicit operator approval.
