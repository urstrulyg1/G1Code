# Current Architecture

## Application

G1Code is a single Electron desktop application. `apps/desktop/electron/main.ts` owns the BrowserWindow, workspace selection, legacy editor file I/O, and human terminal IPC. `preload.ts` exposes a narrow `window.g1code` bridge. The React renderer in `apps/desktop/src/main.tsx` owns the explorer, text editor, terminal, agent activity, sessions, and change review UI.

The production entrypoint was previously inconsistent with the Electron TypeScript output: the package pointed at `dist-electron/main.js`, while the compiler emits `dist-electron/apps/desktop/electron/main.js`. This is corrected as part of the completion work.

## Agent and tools

`packages/agent/runtime.ts` implements a bounded provider/tool loop. It supports streamed provider output, tool calls, cancellation, and a durable asynchronous approval waiter for file changes. `AgentRuntimeManager` keeps active runtimes in memory, so a restart cannot resume execution; persisted sessions are marked interrupted instead.

`packages/tools/workspace.ts` provides read/list/search/write/patch/command tools. File writes are proposal-only and route through `ChangeService`; commands use the cancellable `spawnCommand` abstraction. `packages/tools/git.ts` currently provides read-only status, diff, branch, and log tools.

## Changes and approvals

`ChangeService` is the authority for AI file changes. It persists original/proposed content, SHA-256 hashes, unified diffs, and lifecycle state in SQLite. Main-process IPC authorizes actions against the persisted session and workspace. The renderer displays persisted diffs and never supplies file content or hashes to the apply path.

## Persistence

`better-sqlite3` stores sessions, messages, tool calls, events, file changes, and the repository file index. The schema is created in `packages/database/connection.ts`; migrations are currently lightweight ALTER attempts and need a versioned migration runner for future releases.

## Repository intelligence

`packages/indexing/repository.ts` scans files and calculates metadata hashes. `packages/indexing/search.ts` provides a small ranked search implementation, but it falls back to scanning and reading files for each query. Symbol extraction, imports/exports, deleted-file reconciliation, and watcher-driven incremental updates are incomplete.

## Testing

Unit tests use Node's built-in test runner through `tsx`. Testing primitives detect npm/Maven/Gradle/Go/Cargo/Python/Make projects, rank related test files, construct targeted commands, and stream command output. A deterministic provider and calculator fixture exist. A real Electron E2E harness is not yet present; the local Electron installation previously failed because its binary install script was not available.

## Security

The renderer uses context isolation, disabled Node integration, and a sandboxed preload. Workspace paths use lexical and real-path containment checks. Approval IPC validates change IDs, session IDs, workspace ownership, and action names. Remaining hardening includes comprehensive malformed IPC tests, command environment policy, and a launched Electron security test.

## Incomplete or temporary behavior

- The agent does not yet orchestrate targeted tests and repair attempts itself.
- Git baseline and final AI-versus-user attribution are not persisted.
- Context budgeting is character-based and has no hash deduplication or compaction memory.
- The UI is a compact shell rather than a complete editor/diff/search/Git/testing workbench.
- Project indexing persistence exists at schema level but is not connected to workspace startup.
- The legacy human file-write and terminal IPC endpoints are separate from the agent permission path and require their own policy validation.
