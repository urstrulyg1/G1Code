# Phase 2 Hardening Audit

## Audit scope

Reviewed `apps/desktop/electron`, `apps/desktop/src`, `packages/ai`, `packages/agent`, `packages/tools`, `tests`, and architecture documentation.

## Findings

### Critical

- `agent:stop` is a no-op. Provider streams, approval waits, and commands cannot be cancelled.
- Agent events emitted by `AgentRuntime` use an empty session ID. The Electron adapter adds a session ID only at the renderer boundary, so runtime persistence cannot correlate events.
- Agent sessions, messages, tool calls, events, and file changes are not persisted.
- `workspace:list`, `file:read`, `file:write`, and the human terminal IPC accept renderer-provided paths without workspace authorization.
- `write_file` and `apply_patch` write directly after approval. There is no original hash, unified diff, conflict check, or safe revert.

### High

- `run_command` uses completion-based `execFile`; output is not streamed and abort signals are not connected to a runtime controller.
- Approval listeners can remain pending when a renderer closes or a runtime is cancelled.
- The provider model is hardcoded into the runtime request wrapper instead of being carried as session state.
- Renderer settings payloads are not schema-validated and can persist arbitrary JSON fields.
- The existing human terminal path has broader privileges than agent tools but is not documented or separately validated.

### Medium

- Repository indexing, Git context, context ranking, token budgeting, targeted test detection, and self-repair are absent.
- The explorer and tools only support shallow workspace browsing.
- The renderer is a single large component, making session restoration and event detail difficult to test independently.

## Hardening plan

1. Add a SQLite-backed persistence repository with migrations for sessions, messages, tool calls, events, and file changes.
2. Add `AgentRuntimeManager` with an `AbortController` per session and cancellation-safe approval requests.
3. Replace agent command execution with a spawned streaming process and bounded model output.
4. Add hashes, unified diffs, durable change statuses, conflict checks, and safe revert.
5. Validate all IPC inputs and constrain workspace operations to a selected workspace.
6. Add read-only Git tools and an asynchronous repository index/context budget.
7. Add session restoration, recent-session UI, unit tests, security tests, and temporary-project E2E tests.

## Scope decisions

The current provider remains configurable OpenAI-compatible. Experimental Labs is not implemented because authoritative API documentation remains unavailable; no endpoint or model is fabricated.

## Implemented in this increment

- SQLite schema and repository methods for sessions, messages, tool calls, events, and file changes.
- Session-scoped runtime manager with `AbortController`, runtime stop, persisted terminal states, and explicit no-auto-resume behavior.
- Workspace containment for legacy human file and terminal IPC after folder selection.
- Read-only Git tools for status, diff, branch, and log.
- Spawn-based command abstraction with cancellation and bounded captured output.
- SHA-256 guarded file change application, unified diff generation, conflict detection, and safe revert primitive.
- Line-range file reads and asynchronous repository metadata scanning.
- Priority-based context character budget.
- Unit coverage for cancellation, path traversal, provider parsing, guarded changes, and context budgeting.

## Remaining hardening work

- Wire the persisted file-change service into `write_file` and `apply_patch` approvals and render a proper diff viewer.
- Add the full recent-session sidebar and restore messages/events/changes into the agent panel.
- Stream command chunks as activity events to the renderer instead of only returning the final bounded result.
- Add persisted repository index storage, symbol extraction, ranked search, and automatic context assembly.
- Add targeted test/build detection, bounded self-repair, verification result records, and final summaries.
- Add malformed IPC, symlink, renderer isolation, conflict E2E, cancellation E2E, and temporary-project agent E2E tests.
