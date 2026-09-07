# ADR-0008 — Provider-agnostic AI (Arena AI first-class, not exclusive)

**Status:** Accepted  
**Date:** 2026-09-07

## Context

The brief treats Arena AI as a model/agent execution layer and forbids coupling the IDE to one vendor. Cursor’s lock-in (rules, history, billing) is a documented user complaint. Copilot’s lock-in is structural.

## Decision

All model calls go through:

```text
ModelProvider
AgentProvider
ToolProvider
EmbeddingProvider
RerankerProvider
```

Shipped providers: Arena AI, OpenAI, Anthropic, Gemini, Ollama/local, OpenAI-compatible gateways (vLLM, enterprise proxies).

**No package outside `@g1code/ai` may import a vendor SDK.**

Arena AI is a first-class provider and the default when configured, not a hidden singleton.

## Alternatives

- Hard-code Arena AI — violates the brief and creates the Cursor problem.
- Only local models — not competitive for hard agent tasks in 2026.
- Only frontier APIs — kills privacy/offline/enterprise.

## Reason

Model routing, cost, privacy, and outages are product features. They require an interface.

## Consequences

- Streaming, tool-calling, and vision capabilities are **capability flags** on the provider, not `if (openai)`.
- Eval harness must run against a recorded fixture provider so CI does not need live keys.
- Users configure: Default, Fast, Reasoning, Agent, Embedding, Vision models.
