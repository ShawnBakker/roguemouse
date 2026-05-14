---
description: Explore approaches and tradeoffs for a feature before any specification work.
---

# /brainstorm

Use this command to explore the design space for a new feature or architectural change. The output is a single brainstorm document that surfaces approaches, tradeoffs, and unanswered questions. **No code is written during this stage.**

## What to do

1. Read the feature description provided by the operator carefully. If the description is vague, ask one clarifying question and stop. Do not guess.

2. Read the relevant existing code. Identify what already exists that this feature would touch, extend, or replace. Cite specific files and line ranges in the brainstorm.

3. Identify 2–4 distinct approaches that could solve the problem. For each:
   - One-paragraph description
   - Bulleted pros
   - Bulleted cons (be honest — every approach has real costs)
   - Estimated complexity (small/medium/large)
   - What it would force into scope (e.g., "this approach requires adding a Redis cache")
   - What it would leave out (anti-features — what we deliberately don't get)

4. Identify open questions that block specification. These are decisions the operator needs to make, not technical mysteries Claude Code should solve. Examples: "Do we surface dissent in the UI or only in the audit log?", "Should retries use exponential backoff or fixed-delay?"

5. Recommend one approach. Be opinionated. Frame it as "I'd recommend Approach B because…" and give the reasoning in 2–4 sentences.

## Output

Write the brainstorm to `docs/sprints/[feature-name]/brainstorm.md`.

If `docs/sprints/[feature-name]/` does not exist, create it.

The brainstorm document structure:

```markdown
# [Feature Name] — Brainstorm

## Problem
[1–2 paragraphs: what we're trying to solve and why now]

## Existing code touched
- `path/to/file.ts:LN-LN` — [what's here today]
- `path/to/other.ts:LN-LN` — [what's here today]

## Approach A — [name]
[paragraph]
Pros:
- [bullet]
Cons:
- [bullet]
Complexity: small | medium | large
Forces into scope: [bullet list]
Anti-features (what we deliberately don't get): [bullet list]

## Approach B — [name]
[same structure]

## (additional approaches as needed)

## Open questions
1. [question requiring operator decision]
2. [question requiring operator decision]

## Recommendation
I'd recommend [Approach X] because [2–4 sentences].
```

## Stop gate

When the brainstorm is complete:
1. Report the file path where you wrote the brainstorm
2. Summarize in 2–3 sentences which approach you recommended and why
3. Stop

Do not proceed to `/spec-task`. Do not write code. Wait for explicit operator approval to move to the next stage.
