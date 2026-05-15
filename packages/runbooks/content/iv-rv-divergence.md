# Implied vs. Realized Volatility Ratio Divergence

## When this fires

This alert triggers in `#trading-ops-alerts` when the calculated ratio between implied volatility (IV) from the options surface layer and realized volatility (RV) from the historical spot feed breaches the critical tracking threshold (default parameters: ratio < 0.45 or ratio > 2.60) across any active execution pair. This anomaly indicates either extreme structural pricing dislocations, a major unannounced market regime shift, or—more commonly—a frozen data ingress pipeline serving stale quotes to the pricing layer.

## Diagnostic steps

1. **Verify Ingress Liveness:** Check the timestamp logs for the primary data feed. If the delta between current system time and the last ingested tick is greater than 1200ms, the divergence is an artifact of data staleness, not market structure.
2. **Inspect Raw Surface Arrays:** Query the state memory for the current implied volatility surface. Look for null values or repeating identical float arrays across consecutive execution blocks, indicating an unhandled pricing API exception.
3. **Cross-Check Alternative Venues:** Compare the local data feed's raw spot price drift against the secondary backup feed layer to confirm if a true macro regime shift (e.g., sudden liquidity evaporation) is underway.
4. **Evaluate Ratio Calculation Logs:** Check the governance layer logs to ensure the calculation isn't dividing by zero or processing uninitialized memory values from recent model cold starts.

## Mitigation

1. **Force Feed Restart:** If data ingress is stale, issue a recycling command to the data feed connection pooling layer to flush corrupted memory buffers.
2. **Override Ratio Bounds:** If a verified macro market event is occurring, manually execute the adjustment script to temporarily widen the operational IV/RV ratio tolerance bands to avoid cascading strategy blockades.
3. **Impose Strategy Throttle:** If the data stream is healthy but the ratio remains anomalous without clear market drivers, signal the execution engine to drop order size metrics by 50% immediately.

## Escalation path

Ops Squad handles initial environment diagnostics. If the data feed is confirmed healthy but the mathematical divergence persists beyond 3 minutes, page the Risk Desk immediately with the current state vector dump.