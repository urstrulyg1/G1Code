# Phase 4 Audit and Prioritized Plan

Audit date: 2026-10-05. Branch: `arena/01a10ce7-g1code` (from `main` @ `36aaa55`).

This document is the result of a full read of the repository before any Phase 4 change:
`apps/desktop/electron/*`, `apps/desktop/src/*`, `server.ts`, every package under `packages/`,
all tests, and all architecture/development documentation.

## 1. What actually runs today

The product is an Electron shell plus a local HTTP backend. Understanding this is essential
because it decides where every privileged operation must live.

```text
Renderer (React, sandboxed, no Node)
   │  window.g1code  (contextBridge)
   ▼
Electron main  ── IPC ──▶ HTTP 127.0.0.1:3131  ──▶ Agent runtime ──▶ tools ──▶ filesystem/commands
   │                            (server.ts)                 │
   └── SSE bridge (agent events, permission requests)        ▼
                                                       better-sqlite3
```

* `apps/desktop/electron/main.ts` — BrowserWindow creation, workspace selection, a thin HTTP
  bridge, and an SSE relay into the renderer. All the real work is proxied to the backend.
* `server.ts` — the privileged boundary. Owns the agent runtime, approval waiters, the
  repository index, change batches, Git endpoints, settings, and the model catalog.
* `packages/*` — the shared implementation used by `server.ts` (agent runtime, tools,
  indexing, context budget, database, testing, security).
* `apps/desktop/src/main.tsx` — one 7 700-line React component that is the entire UI.

## 2. Implemented vs. only documented

| Area | State | Evidence |
| --- | --- | --- |
| Electron security baseline | Implemented | `contextIsolation`, `sandbox`, `nodeIntegration:false`, window-open denied |
| Preload bridge | Implemented | narrow `window.g1code` surface (`preload.ts`) |
| Workspace containment | Implemented | `safePath` / `safeRealPath` with real-path and symlink checks |
| Command execution | Partial | `spawnCommand` is cancellable and streams, but streaming is not surfaced to the renderer and the Electron `terminal:run` path is still completion-only |
| Agent runtime loop | Implemented | provider stream → tool calls → approval → persist |
| Session cancellation | Partial | `agent:stop` releases waiters and aborts, but there is no explicit `cancelling` state and cleanup is best-effort |
| Session persistence | Implemented | sessions / messages / tool calls / events / changes / batches in SQLite; restart marks sessions interrupted |
| Session restore | Partial | persisted events and messages exist, but sessions cannot be renamed/archived/deleted and the list omits change + verification counts |
| Streaming | Partial | assistant text and command chunks exist; no bounded buffering, no terminal-stream recovery, no explicit activity taxonomy |
| File changes | Implemented | proposed/approved/applied states, SHA-256 original+proposed hashes, unified diff, conflict detection, safe revert, transactional batches |
| Approvals | Implemented | server-side waiters with timeout, single-resolution guard, approve/reject all |
| Repository indexing | Partial | incremental scan + symbol extraction exist, but imports/dependencies, git awareness, and ranked search are not wired into any route or tool |
| Context assembly | Partial | `ContextBudgetManager` + hash dedupe exist, but nothing assembles real repository context per request |
| Verification pipeline | Partial | project detection, test discovery and targeted commands exist; the pipeline is agent-driven, not deterministic |
| Bounded self-repair | Partial | a repair counter exists in the runtime; verification-driven bounded repair does not |
| Git | Partial | read-only status/diff/branch/log tools plus human-only commit; no blame, no staged diff, no history-aware context |
| Observability | Partial | console logging only, no channels, no diagnostics view |
| Renderer architecture | Not implemented | single component; sub-behaviours are not separately testable |
| Tests | Implemented | 90 tests (89 pass, 1 skipped) before changes |

## 3. Duplicate or dead functionality

1. **Dead duplicate agent runtime.** `apps/desktop/electron/runtime.ts` (1 040 lines) contains a
   complete second copy of the agent runtime, approval waiters, and every agent IPC handler.
   Nothing imports `registerRuntimeHandlers`, so it is unreachable code that will drift from
   the live implementation in `server.ts`. Two copies of the permission logic is a security
   liability, not a feature.
2. **Three overlapping search paths.** `grep` (`/api/workspace/search`), `store.searchSymbols`,
   and `packages/indexing/search.ts:rankedSearch`. Only the first two are reachable;
   `rankedSearch` is dead code.
3. **Two terminal paths.** Agent `run_command` (streaming, cancellable, bounded) and the human
   `terminal:run` IPC (completion-only `execFile`, different limits). The human path is weaker
   than the agent path.
4. **Two `run_command` style tools.** `run_command` (workspace tools) and `run_tests` (testing
   tools) duplicate command-approval and streaming logic.

## 4. Architectural weaknesses and risks

Severity ordering. Each item lists the concrete consequence.

**Critical**

1. `npm install` fails outright on any machine without a pre-populated Electron cache:
   the `postinstall` script exits non-zero and aborts the install. This breaks onboarding and
   CI from a clean checkout.
2. Dead `runtime.ts` duplicates the permission layer. Any future edit to `server.ts`
   permissions silently leaves the stale copy behind (and vice versa).
3. The renderer-closed path is unhandled: if the window closes while an approval waiter is
   pending, the runtime is suspended until the 15-minute timeout because nothing tells the
   server the renderer is gone.

**High**

4. IPC inputs are forwarded to the backend with almost no validation
   (`agent:change`, `settings:save`, `provider:*`, `git:commit`, `index:*`). Validation exists
   in `packages/security/validation.ts` but is only used in tests.
5. Human file writes (`file:write` / `/api/file/write`) have no hash guard: the editor path can
   silently clobber work the agent or the user just produced.
6. `terminal:run` (both Electron and server) is completion-only `execFile`, with no streaming,
   no process-tree cleanup, and a smaller safety envelope than the agent path.
7. Repository index is never built automatically for an opened workspace, so
   `search_repository_context` returns empty until someone calls `/api/index/rebuild`.
8. No structured logging: failures in provider/tool/verification paths are only visible in the
   server console, and there is no way to inspect them from the UI.

**Medium**

9. Self-repair is not verification-driven and has no persisted limit configuration surfacing in
   the UI.
10. Session list has no change count, no verification result, no rename/archive/delete.
11. Provider stream interruption (socket reset mid-stream) surfaces as a hard failure with no
    bounded recovery attempt.
12. Agent context is whatever the model asks for; there is no automatic context assembly from
    the open file, selection, related symbols, git changes, tests, or config.
13. `docs/architecture/*` is thin (3–49 lines per file) and partly out of date.

## 5. Prioritized plan for this phase

The plan is ordered exactly as required: P0 reliability/security first.

### P0 — Reliability and security
1. Make `npm install` reliable without an Electron cache; make Electron preflight degrade to a
   clear warning and add a strict mode for CI.
2. Delete the dead duplicate runtime; keep `server.ts` as the single privileged boundary.
3. Introduce a real session lifecycle (`created → running → waiting_for_approval → cancelling →
   completed | failed | cancelled`, plus `interrupted`) with a per-session `AbortController`
   owned by the manager, idempotent cancellation, guaranteed listener/child cleanup, and
   deterministic event ordering.
4. Handle renderer/window close: notify the server so approval waits and streams unwind.
5. Validate every Electron IPC payload with strict schemas.
6. Give the human file-write path a hash guard and give `terminal:run` the streaming,
   cancellable, bounded implementation.
7. Add security regression tests: traversal, symlink, malformed IPC, oversized payloads,
   command injection, renderer isolation.

### P1 — Core AI IDE
8. Persist and incrementally maintain the repository index on workspace open, with
   imports/exports, git awareness, and file-change detection.
9. Wire ranked repository search (filename/path/symbol/text/recent/git-aware) as a route and an
   agent tool.
10. Automatic context assembly with relevance ranking, dedupe, a strict budget, and an
    observable manifest.
11. Streaming improvements: bounded buffering/backpressure, provider stream recovery, explicit
    activity taxonomy (thinking/response/tool/command/approval/file change/verification/result).
12. Diff viewer, session sidebar (rename/archive/delete, counts), approval UX.

### P2 — Developer intelligence
13. Deterministic verification pipeline (affected files → relevant tests → type-check/lint →
    build) with persisted results.
14. Bounded self-repair driven by verification failures (default 2–3 attempts), always through
    the change/approval system.
15. Git intelligence: staged diff, blame, commit inspection, history-aware results, changed-file
    to test mapping.
16. Structured logging plus a diagnostics view (sessions, runtime state, provider status,
    indexing status, recent tools, errors, verification).

### P3 — UX and performance
17. Renderer refactor into focused components with testable state boundaries, virtualized long
    lists, lazy loading, and bounded queues.

### P4 — Advanced
18. Deeper symbol/dependency analysis and ranking improvements, richer Git workflows, and
    provider capabilities that the configured provider actually exposes.

## 6. Explicit non-goals

* No new AI provider is invented. The configured OpenAI-compatible "Experiential Labs" provider
  is the only one, and its capabilities are read from the model catalog.
* No automatic commit/push. Commit stays a human action; push is not implemented.
* No claim of a real Electron E2E run in environments without an Electron binary; the suite
  reports the skip instead of failing silently.

## 7. Baseline test evidence (before Phase 4 changes)

```text
$ npm install --ignore-scripts && npx node-gyp rebuild   # better-sqlite3 needs local headers
$ npm test
# tests 90
# pass 89
# fail 0
# skipped 1
$ npm run build   # tsc (renderer) + vite build + tsc (electron) — clean
```

`npm install` fails without `--ignore-scripts` on a clean machine; the Electron binary cannot be
downloaded in the audit sandbox (`objects.githubusercontent.com` unreachable), so Electron E2E
was not executed there. Both facts are addressed in P0-1 and P3-17.
