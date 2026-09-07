# AI Provider Architecture

`AIProvider` is the vendor-neutral contract. It exposes model discovery, streaming completion, tool-call requests, capability metadata, usage, rate-limit metadata, cancellation, and normalized errors.

The first adapter is `ExperimentalLabsProvider`. Its endpoint, authentication, and model catalog are configuration-driven; no model name is permanent. Future adapters include OpenAI, Anthropic, Gemini, OpenAI-compatible, and local providers. A router selects models by task class, while the context manager controls the request payload.

Phase 2 ships an OpenAI-compatible transport adapter as the verified protocol boundary. The requested Experimental Labs public documentation was unavailable during implementation, so no unverified vendor endpoint or model is hard-coded. The adapter supports `/models`, `/chat/completions`, SSE streaming, tool calls, timeout/cancellation through `AbortSignal`, normalized errors, and bounded retries for 429/5xx/network failures.

API keys must be stored through OS credential storage. They must not enter renderer state, logs, diagnostics exports, or persisted SQLite records.
