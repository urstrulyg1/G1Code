# Phase 4 — Production Hardening: implementation report

Scope: evolve the existing G1Code architecture (Electron main + preload →
React renderer → privileged Node backend on `127.0.0.1:3131`) into a reliable,
repository-aware AI development environment without rewriting it.

This report describes **what is implemented and verified in this repository**.
Anything not listed as implemented is listed under
[Remaining limitations](#remaining-limitations).

---

## 1. Architecture summary

```
┌──────────────────────────── Renderer (React 18, no Node) ──────────────────┐
│ AppShell │ Explorer/Editor │ AgentPanel (timeline, approvals, changes)     │
│          │ Terminal/Status │ agent-events.ts  ← pure, unit-tested logic    │
└───────────────────────────────┬────────────────────────────────────────────┘
        window.g1code (preload, schema-validated, single-object payloads)
┌───────────────────────────────▼────────────────────────────────────────────┐
│ Electron main                                                              │
│  • IPC_SCHEMAS validation for every channel                                │
│  • workspace file read/write (sha256 guard + atomic rename)                │
│  • streaming terminal execution, process tree cleanup                      │
│  • backend supervision; notifyRendererClosed() cancels orphaned runs        │
└───────────────────────────────┬────────────────────────────────────────────┘
        HTTP JSON + SSE (/api/events)
┌───────────────────────────────▼────────────────────────────────────────────┐
│ Backend (server.ts) — the only privileged boundary                         │
│  AgentRuntimeManager ── AgentSession(lifecycle, AbortController, cleanup)  │
│  AgentRuntime ── provider streaming, tool loop, approval gates             │
│  ToolRegistry ── permission-policy.decidePermission() for every call       │
│  RepositoryIndexService → SQLite (files, symbols, imports, git meta)       │
│  RepositorySearchService ── filename/symbol/text/import/git/recency rank   │
│  ContextAssembler ── ranked, budgeted, deduplicated, observable manifest   │
│  ChangeService ── PENDING→APPROVED→APPLYING→APPLIED/REJECTED/CONFLICT      │
│  Verification pipeline ── typecheck / targeted tests / build, persisted    │
└────────────────────────────────────────────────────────────────────────────┘
```

Key properties:

- **One privileged boundary.** The backend owns the filesystem, processes and
  credentials. The renderer never receives Node APIs, secrets, or raw paths.
- **One permission authority.** `packages/security/permission-policy.ts` decides
  `allow | ask | deny` for every tool call, from every entry point.
- **One session model.** `AgentSession` owns the lifecycle state machine, the
  `AbortController`, child-process tracking, and the cleanup registry.
- **Deterministic persistence.** Events are written before they are broadcast,
  ordered by `(timestamp, rowid)`, and replayed by id/seq so SSE, history and
  polling can never duplicate a row in the UI.

## 2. Significant changes

| Area              | Change                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session lifecycle | `created → running → waiting_for_approval → cancelling → completed/failed/cancelled`; terminal states are final; cancel is idempotent and observable (`requested \| already-cancelling \| not-found`).                                                                                                 |
| Cancellation      | Per-session `AbortController`; provider streams, tool calls, approval waits, and child processes all observe one signal; `registerCleanup`/`trackProcess` release resources exactly once.                                                                                                              |
| Runtime events    | Every event carries the correct `sessionId` plus an `activity` taxonomy (`thinking`, `response`, `tool`, `command`, `approval`, `file_change`, `verification`, `result`, `status`). Reasoning deltas are counted and surfaced only as activity — never persisted, never displayed as chain-of-thought. |
| Streaming         | Coalesced assistant text (`BoundedTextBuffer`, 4 KB flush), bounded SSE queues, backpressure accounting, command output streamed and folded into the originating row.                                                                                                                                  |
| Repository index  | Durable index of files, languages, symbols, imports/exports and git state; incremental by size+mtime+hash; cancellable; progress phases `scan/symbols/imports/git/done`; `indexPaths()` for watcher-driven updates.                                                                                    |
| Ranked search     | Single entry point over filename, path, symbol, text, imports, git dirty state and recency, with reasons per hit and a bounded text scan (250 files / 200 KB per search).                                                                                                                              |
| Context assembly  | Nine ranked sources, strict character budget, content-hash deduplication, binary/vendor/generated exclusion, untrusted-content wrapping, and a manifest listing every included file with its reason and size.                                                                                          |
| Verification      | `targeted` / `typecheck` / `build` / `full` levels run real project commands, stream per-step events, persist to `verification_runs`, and report a summary.                                                                                                                                            |
| Git intelligence  | Status/diff/log/branch from existing tools plus new blame and per-file history endpoints that return line attribution and commit metadata, and degrade gracefully outside a repository.                                                                                                                |
| Session history   | `/api/agent/sessions` returns sidebar metadata (title, status, timestamps, change/applied/conflict counts, latest verification status, archived) plus rename/archive/unarchive/delete endpoints.                                                                                                       |
| Diagnostics       | `/api/diagnostics` reports runtime state, active sessions, provider state (masked credential), index freshness, recent tool calls, recent errors, and recent verification runs — never secrets.                                                                                                        |
| Renderer          | Agent event model extracted into `apps/desktop/src/agent-events.ts` (pure, unit-tested); automatic context assembly rendered as a readable summary; terminal-state handling shared.                                                                                                                    |
| DX                | `postinstall` verifies Electron without breaking installs; `preflight:electron[:strict]`; `typecheck`, `lint`, `test:unit`, `test:security`, `e2e:backend`, `e2e:electron`, `verify`; CI runs unit/security/build on Node 20/22/24 and the headless E2E on Linux/macOS/Windows.                        |

## 3. Security improvements

- **IPC validation.** ~50 channels have explicit schemas (`ipc-schemas.ts`);
  unknown fields are rejected, payload size is capped (1 MB, 10 MB for editor
  content), and malformed payloads fail closed.
- **Workspace containment.** Every path goes through `safeRealPath()`, which
  resolves symlinks and junctions and rejects anything outside the selected
  workspace. `checkedWorkspace()` refuses cross-workspace requests.
- **No silent overwrites.** Renderer and HTTP writes accept an `expectedHash`;
  a mismatch returns `{conflict: true}` instead of clobbering, and writes are
  staged to a `0o600` temporary file and renamed into place.
- **Permission gate.** Unknown tools are denied; disabled capability switches
  deny; `delete_file` and `DESTRUCTIVE`/`PRIVILEGED`/`DEPENDENCY_CHANGE`
  commands always require approval; `plan`/`readonly` deny non-read-only work;
  denials are persisted as auditable approval events.
- **Credential handling.** API keys are read from the environment, `~/.zshrc`
  or encrypted storage (`safeStorage`, else AES-GCM with a `0o600` key file);
  only `apiKeyConfigured`/`apiKeyMasked` ever leave the backend.
- **Redaction.** Tool events, command output and persisted payloads pass through
  `redactObject`/`redactSecrets` (private keys, bearer tokens, `sk-`/`ghp_`,
  `key=value`, env secrets) before storage or broadcast.
- **Origin + process hygiene.** The backend rejects untrusted browser origins,
  Electron runs with `contextIsolation`, `nodeIntegration: false` and a narrow
  preload surface, and cancelling a session kills its process tree.

## 4. Agent lifecycle

| State                                | Meaning                                    | Exits                                                       |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `created`                            | session object exists, nothing scheduled   | `running`, `cancelled`                                      |
| `running`                            | provider/tool loop active                  | `waiting_for_approval`, `cancelling`, `completed`, `failed` |
| `waiting_for_approval`               | blocked on a permission or change decision | `running`, `cancelling`                                     |
| `cancelling`                         | cancel requested, cleanup in progress      | `cancelled` only                                            |
| `completed` / `failed` / `cancelled` | terminal, final                            | —                                                           |

- `cancelSession()` returns `requested`, `already-cancelling`, or `not-found`;
  waiters are released before the abort so a pending approval cannot stall.
- Approvals time out (default 15 min) to `REJECTED`; closing the renderer
  cancels live sessions instead of leaving them suspended.
- Sessions are restored **without** resuming: startup marks unfinished sessions
  interrupted and the UI shows persisted history.

## 5. Indexing and context selection

- Index: `packages/indexing/service.ts` (incremental, coalesced per workspace,
  progress callbacks, `AbortSignal`), `imports.ts` (JS/TS, Python, Go, Rust,
  Java-like), `git-context.ts` (two bounded git calls), `search-service.ts`.
- Ranking boosts: exact/prefix filename matches, symbols (exact > prefix),
  text matches bounded by file size, import/importer relevance, dirty working
  tree (+18), the currently open file (+40), same directory (+12), depth penalty
  and test-to-test affinity.
- Context assembly priorities: attachments 100 → selection 98 → open file 95 →
  search/symbol 70 → git-modified 65 → dependency 60 → related test 55 →
  session summary 45 → config/instructions 40 → recency 35.
- The first request in a workspace indexes in the background and waits at most
  4 s, so the very first answer is already repository-aware without blocking the
  UI. Every run returns and persists its manifest.

## 6. File-change safety model

1. A tool proposes `{path, content}`; the backend reads the current file and
   records `original_hash`/`original_content` plus the proposed diff.
2. The change is persisted as `PENDING` and surfaced to the user (or resolved by
   the configured `reviewPolicy`).
3. On approval, `ChangeService` re-checks the on-disk hash; a mismatch becomes
   `CONFLICT` and asks the user instead of overwriting.
4. Applying writes a staged `.g1code-batch-*` file, verifies the hash, then
   renames atomically; a failure rolls back to the previous content and is
   reported as `PARTIAL_FAILURE` rather than a silent half-write.
5. Reject and revert keep the original content and are recorded as auditable
   events; unresolved batches are reconciled on startup.

## 7. Verification and bounded self-repair

- Verification levels: `typecheck` (project script or `tsc --noEmit`),
  `targeted` (tests narrowed to the changed paths), `build` (project build
  script), `full` (typecheck + targeted tests). Build is never run implicitly.
- Runs are persisted (`verification_runs`: status, level, changed files, steps,
  summary) and streamed step by step for the UI.
- Self-repair is bounded: the runtime feeds the failure output back to the
  model, may retry up to `maxRetries` (default 2–3, hard-capped at 8), records
  every attempt and change id, and stops at the limit with a report. Repairs go
  through the same permission, approval and change-safety path as any edit.

## 8. Tests executed and results

| Suite                         | Command                                                | Result                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration            | `npm test`                                             | **132 tests, 131 pass, 0 fail, 1 skipped**                                                                                                           |
| Repository intelligence (new) | `npx tsx --test tests/repository-intelligence.test.ts` | 7/7 pass — imports, incremental index, ranked search, git boost, context ranking/budget, tool permissions                                            |
| Agent event model (new)       | `npx tsx --test tests/agent-events.test.ts`            | 6/6 pass — chunk folding, duplicate suppression, command chunking, approval resolution, activity classification                                      |
| Headless E2E                  | `npm run e2e:backend`                                  | **13/13 stages pass** (see below)                                                                                                                    |
| Typecheck                     | `npm run typecheck`                                    | clean (renderer + Electron main)                                                                                                                     |
| Build                         | `npm run build`                                        | green (1594 modules; renderer + main emitted)                                                                                                        |
| Live API smoke                | `curl` against a running backend                       | index 166 files/441 ms; ranked search; context assembly; verification `typecheck` PASSED in 8.0 s and persisted; git blame/file-history; diagnostics |

Headless E2E stages: workspace opened and provider configured → repository
indexed → indexed/searched/status → context assembled with manifest → agent run
proposed a change → approval applied it (file verified on disk) → change history
records APPLIED → verification ran and persisted (PASSED) → diagnostics expose
runtime state without secrets → session renamed/archived/listed → rejection left
the workspace untouched and was audited → cancellation terminated a streaming
run → restart restored history without resuming → git blame and file history
returned real attribution.

The E2E spawns the real backend against a temporary project with a local
OpenAI-compatible mock provider, so it requires no Electron binary, no network
and no API key.

## 9. Remaining limitations

Honest state of what is **not** finished:

- **Renderer refactor is partial.** The event model and API client are separated
  and tested, and the conversation timeline is already segmented by activity,
  but `apps/desktop/src/main.tsx` is still a large component file. The planned
  `AppShell`/`Explorer`/`Editor`/`AgentPanel`/`Terminal`/`StatusBar` component
  split is not complete.
- **Session sidebar UI.** The backend exposes rename/archive/unarchive/delete
  and rich history metadata, and the preload surface exists, but the sidebar
  does not yet expose those actions in the UI.
- **Verification "full" level** runs typecheck + targeted tests only; it does
  not run lint or a full build (deliberate, to avoid blindly running everything).
- **Self-repair** is bounded and audited but has no UI to inspect the repair
  attempts beyond the persisted events/summary.
- **Renderer-side terminal cancellation** still lacks an IPC cancel channel; the
  human terminal can be started and streams output, but stopping a running
  command from the UI is not wired.
- **Symbol/dependency depth** is regex-based (no language server): symbols are
  declarations and imports, not a full type graph.
- **Provider support** is the repository's existing OpenAI-compatible provider;
  no additional provider APIs or models were invented.
- **Local environment limits:** the Electron binary cannot be downloaded in this
  sandbox and there is no X server, so `npm run e2e:electron`, `e2e:smoke` and
  packaging were not executed here; CI covers them on runners with a display.
- The chat-transcript mirror writes to `<home>/G1Code/chats`; in this sandbox the
  repository itself lives at `~/G1Code`, so running the test suite leaves
  timestamp-only changes in `chats/` that should not be committed.

## 10. Documentation

- `README.md` — updated architecture, scripts and security baseline.
- `docs/development/phase-4-audit-and-plan.md` — audit, duplicate findings, plan.
- `docs/development/phase-4-implementation-report.md` — this report.
- Older phase documents remain as historical records; where they describe
  behaviour that has changed (for example the inline permission chain), this
  report and the code are authoritative.
