# ADR-0011 — MCP for tools, ACP for external agents

**Status:** Accepted  
**Date:** 2026-09-07

## Context

Two open protocols matured in 2025–2026:

- **MCP (Model Context Protocol)** — how an agent talks to *tools, resources, prompts* (GitHub, DBs, k8s, docs). VS Code Copilot standardized on MCP. Cursor RCE (CVE-2025-54135) and GitHub MCP “toxic agent flow” showed the security cost.
- **ACP (Agent Client Protocol)** — how an *external coding agent* (Claude Code, Gemini CLI, Copilot CLI, Goose, Codex) talks to an *editor*. Zed created it. Microsoft has not first-partied it in VS Code.

G1Code needs both: we are a host for our own agents **and** a client for the agent ecosystem.

## Decision

- **MCP:** first-class. G1Code is an MCP host/client with a registry UI, per-server permissions, tool allowlists, and untrusted-content handling.
- **ACP:** first-class. G1Code can run external ACP agents beside the native orchestrator.
- Native G1 agents do **not** have to speak ACP internally; they use `AgentRuntime`. ACP is the *interoperability* boundary.

MCP is not a substitute for built-in tools (fs, git, lsp, test). Built-in tools are faster, permissioned, and auditable. MCP is for *external* systems.

## Alternatives

- MCP only — cannot host Claude Code/Gemini CLI as peers.
- ACP only — cannot use the 8k+ MCP server ecosystem.
- Proprietary plugin tools only — vendor lock-in.

## Reason

MCP = USB for tools. ACP = LSP for agents. G1Code should speak both the way it speaks LSP and DAP.

## Consequences

- Permission UX is shared across built-in tools, MCP, and ACP.
- MCP servers are untrusted by default (see security architecture).
- Eval tests must include a malicious MCP fixture.
