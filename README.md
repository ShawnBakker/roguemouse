# roguemouse

**An autonomous AI Operations Officer for algorithmic trading platforms.**

Roguemouse watches a running options trading system, diagnoses anomalies
in plain English, proposes remediation with human-in-the-loop approval,
and produces audit-ready reasoning traces.

Built for the AI Agent Olympics Hackathon at Milan AI Week 2026.

## Status

🚧 Under active development during the hackathon build window
(May 13–19, 2026). This README will be expanded as the project lands.

## Architecture (preview)

- **Brain (Risk Officer voice):** Gemini 3 Pro
- **Brain (Ops Engineer voice):** Llama 3.x via Vultr Serverless Inference
- **Brain (Synthesizer):** Gemini 3 Flash
- **System of record:** Vultr Object Storage (audit bucket)
- **Retrieval:** Vultr Serverless Inference Vector Store (runbook RAG)
- **Compute:** Vultr Cloud Compute (EU region)

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

Roguemouse does not place real trades. The "broker" in this project
is a deterministic mock that replays seeded fixtures. No live
brokerage account is connected. No real money is at risk.
