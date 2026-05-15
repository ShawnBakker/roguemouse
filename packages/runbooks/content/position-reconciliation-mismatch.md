# Platform and Broker Position Reconciliation Mismatch

## When this fires

This exception drops directly into `#prod-incidents` during the continuous intra-day reconciliation loop or the nightly hard settlement sweep. It triggers when the absolute state delta between the internal position store layer and the payload returned by the broker API exceeds the zero-tolerance boundary of 0.0001 units. This state variance typically points to ghost positions caused by race conditions during multi-threaded order routing, or untracked fills resulting from dropped socket connections during high-throughput execution sequences.

## Diagnostic steps

1. **Dump Execution State:** Extract the raw transaction history ledger from the local position store for the past 60 minutes.
2. **Diff Broker Receipts:** Query the broker API directly using the raw transport log utility to pull all executed order IDs matched against local transaction tracking UUIDs.
3. **Isolate Ghost Orders:** Locate any entry present in the broker payload that lacks a corresponding, state-committed record in the local position engine. Check for partial fills that might have bypassed the internal listener.
4. **Review Network Ingress Logs:** Inspect the edge load balancer logs for connection resets or timeout packets matching the exact millisecond window of the un-reconciled execution.

## Mitigation

1. **Lock Pair Execution:** Instantly issue an emergency freeze command for the affected asset pair to prevent the agent loop from escalating the balance divergence.
2. **Execute Hard Sync Utility:** Run the manual reconciliation override script to forcefully inject the verified broker API position state into the internal position store.
3. **Cancel Pending Flights:** Purge all open, unexecuted resting orders at the broker level for the specific asset to clear the slate before releasing the execution lock.

## Escalation path

Ops Squad must immediately lock the pair and attempt automated sync. If the discrepancy cannot be resolved programmatically within two reconciliation cycles, escalate directly to the Risk Desk with the precise transaction delta ledger.