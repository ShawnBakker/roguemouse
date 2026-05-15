# LLM Client Circuit Breaker Open Condition

## When this fires

This critical priority alert flashes in `#prod-incidents` when the internal Vultr Inference API client wrapper shifts its state machine from CLOSED or HALF-OPEN to OPEN. This occurs automatically when consecutive outbound calls to the configured endpoint experience repeated 5xx network errors, physical timeouts, or severe rate-limiting token saturation beyond the safe operational threshold.

## Diagnostic steps

1. **Ping Base Endpoint URL:** Execute a direct diagnostics curl request against `VULTR_INFERENCE_BASE_URL` from the local network layout to determine if the issue is a systemic Vultr outage or a localized DNS routing failure.
2. **Analyze Error Code Composition:** Review the client wrapper logs to determine the exact error signature. Differentiate between `HTTP 429` (Rate Limiting) and `HTTP 503` (Service Unavailable).
3. **Check API Key Entitlements:** Verify that the configured `VULTR_INFERENCE_API_KEY` hasn't hit spending ceilings, expired, or been revoked by inspecting the credential validation metrics.
4. **Monitor Error Windows:** Track the circuit breaker’s internal cooldown timer to determine when the next automated HALF-OPEN probe is scheduled to fire.

## Mitigation

1. **Activate Risk-Degrade Mode:** If the open circuit breaks critical real-time risk assessment loops, the system must fail loud—immediately suspend active trading loops. If it handles non-critical synthesis, allow execution to continue using cached fallback assessments.
2. **Switch Model Ingress Paths:** Modify the inference configuration parameters to route operations toward secondary backup model tags if available.
3. **Reset Circuit Cooldown:** If the endpoint recovery is verified manually via direct curl, execute the circuit reset script to forcefully transition the state back to CLOSED.

## Escalation path

Ops Squad owns the connection and endpoint diagnostics. If the circuit remains persistently OPEN for more than 5 minutes due to verifiable upstream provider infrastructure failure, notify the AI Operations Officer to coordinate systemic fallback procedures.