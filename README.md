# roguemouse

**An autonomous AI Operations Officer for algorithmic trading platforms.**

Roguemouse watches a running options trading system, diagnoses anomalies
in plain English, proposes remediation with human-in-the-loop approval,
and produces audit-ready reasoning traces.

Built for the AI Agent Olympics Hackathon at Milan AI Week 2026.

## Status

Under active development during the hackathon build window (May 13-19, 2026).
This README will be expanded as the project lands.

## Architecture

- **Risk Officer voice**: Gemini (Google AI Studio) — conservative reasoning over alerts
- **Ops Engineer voice**: `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` via Vultr Serverless Inference — diagnostic root-cause analysis
- **Synthesizer**: Gemini Flash — reconciles dissent into a single proposal
- **System of record**: Vultr Object Storage (SHA-256 hash-chained audit log)
- **Retrieval**: Application-layer RAG over a synthetic runbook corpus
- **Compute**: Vultr Cloud Compute VPS (Amsterdam region)

## Audit integrity

Roguemouse uses application-layer SHA-256 hash-chained audit records to detect
tampering. Each record stores the SHA-256 of the prior record as `previousHash`,
forming a verifiable chain. Bucket-level immutability (S3 Object Lock) is not
available on Vultr Object Storage, so tampering detection relies on the
cryptographic chain rather than storage enforcement. A reader can verify
integrity by recomputing each record's hash and confirming the chain links.

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

Roguemouse does not place real trades. The "broker" in this project is a
deterministic module that replays seeded fixtures. No live brokerage account
is connected. No real money is at risk.
