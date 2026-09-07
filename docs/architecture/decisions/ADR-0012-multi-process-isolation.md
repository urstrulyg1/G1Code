# ADR-0012 — Multi-process isolation

**Status:** Accepted  
**Date:** 2026-09-07

## Context

VS Code’s real architecture lesson is not Electron. It is **process isolation**: UI never shares a fate with extensions, language servers, or PTYs. AI IDEs that run agents in the renderer will hitch and crash.

## Decision

Processes:

| Process | Role |
| ------- | ---- |
| Main (Electron) | Windows, OS, auto-update, protocol |
| Renderer | Workbench UI only |
| Extension Host | G1 + compatible extensions |
| AI Host | Model I/O, routing, prompt assembly (no secrets in prompts by default) |
| Agent Runtime | Tool loop, task graph, sub-agents |
| Indexer | Scan, parse, embed, FTS |
| PTY Host | node-pty / conpty |
| LSP / DAP | Child processes per server/adapter |

IPC is async, typed, cancellable. Any process can be killed and restarted.

**Never** on the UI thread: indexing, embeddings, git status for large repos, test runs, agent loops, LSP.

## Alternatives

Single-process Node (simpler, janky). Shared extension+agent process (one bad extension stalls agents).

## Reason

The NFR “the IDE must remain responsive while AI agents work” is a process-model requirement.

## Consequences

- More engineering than a toy editor.
- Crash recovery restores UI state independently of agent state.
- Observability must include per-process health.
