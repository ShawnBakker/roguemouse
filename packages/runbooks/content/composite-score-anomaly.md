# Strategy Composite Score Anomaly and Boundary Violations

## When this fires

Fired automatically by the governance layer into `#trading-ops-alerts` when an active strategy's internal composite score breaches the fixed signed-score semantics range of [-100, +100], or exhibits an instantaneous sign-flip violation (e.g., moving from +98 directly to -98 within a single evaluation sequence) without a corresponding structural change in input data. This behavior points to sign-flip math bugs in downstream weights, unhandled model quantization issues, or boundary inversions inside the inference parser.

## Diagnostic steps

1. **Inspect Logged Feature Inputs:** Pull the exact token evaluation block that generated the anomalous composite score. Inspect the raw numeric array sent to the inference parser.
2. **Trace Weight Signatures:** Check for negative multiplier injections within the strategy's dynamic feature calculation modules. Verify that recent weight adaptations haven't caused a sign-flip inversion.
3. **Query Inference Raw Payload:** Check the raw output from the VULTR_OPS_MODEL before it gets normalized by the governance layer. Determine if the anomaly originated within the model's response or during parsing.
4. **Check Nan/Infinity Accumulation:** Review calculation steps to ensure an unhandled `NaN` or `Infinity` float value didn't cascade through the matrix multiplication steps, breaking signed-score constraints.

## Mitigation

1. **Force Clamp Override:** Execute the governance configuration patch to strictly clamp all outgoing strategy composite scores to a neutral zero state until the logic is patched.
2. **Downgrade Strategy Weights:** Instantly lower the operational allocation weight of the misbehaving strategy token to zero in the active execution router.
3. **Fallback to Fixed Baseline:** Divert the inference routing logic away from dynamic scoring and fallback to the hardcoded deterministic baseline matrix.

## Escalation path

The AI Operations Officer must be paged immediately upon any signed-score boundary breach, accompanied by the raw input/output inference text token trace. Inform the Risk Desk that strategy weights have been zeroed.