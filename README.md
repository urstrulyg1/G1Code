# G1Code AI IDE

G1Code is a repository-aware AI development environment for the desktop. It pairs
a secure Electron main/preload boundary and a React + TypeScript renderer with a
privileged Node backend that owns sessions, the SQLite store, the repository
index, provider credentials, and every filesystem or command operation.

## Development

Requirements: Node.js 20+ and npm 10+. Git is optional (repository intelligence
degrades gracefully outside a repository).

```bash
npm install          # installs dependencies and verifies the Electron binary
npm run dev          # backend (tsx watch) + renderer (vite)
npm run build        # typecheck renderer, bundle, compile Electron main
npm run verify       # typecheck -> format:check -> unit tests -> build -> headless E2E
```

Useful scripts:

| Script                               | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `npm run server`                     | backend only (`http://127.0.0.1:3131`)               |
| `npm test` / `npm run test:unit`     | unit + integration tests (`node:test` via tsx)       |
| `npm run test:security`              | traversal, IPC validation, permission-policy suites  |
| `npm run e2e:backend`                | headless end-to-end agent workflow on a temp project |
| `npm run e2e:electron`               | desktop E2E (requires the Electron binary)           |
| `npm run typecheck` / `npm run lint` | strict TypeScript, no emit                           |
| `npm run preflight:electron:strict`  | fail if the Electron binary is unavailable           |
| `npm run electron:build`             | package the desktop app                              |

## Architecture

```
Renderer (React, no Node access)
   │  window.g1code  (validated preload API)
   ▼
Electron main  ──HTTP + SSE──►  Backend (server.ts, 127.0.0.1:3131)
   │                                │
   │                                ├─ AgentRuntime + AgentRuntimeManager
   │                                ├─ ToolRegistry (permission-gated)
   │                                ├─ RepositoryIndexService / SearchService
   │                                ├─ ContextAssembler
   │                                ├─ ChangeService (hash-safe file writes)
   │                                └─ SQLite (sessions, events, index, changes)
```

Nothing in the renderer can read a file, spawn a process, or reach a credential
directly: every capability crosses a schema-validated IPC channel and is
re-checked by the backend against the selected workspace.

## Project layout

- `apps/desktop/electron`: main process, preload bridge, IPC schemas
- `apps/desktop/src`: React UI, event model (`agent-events.ts`), API client
- `packages/agent`: session lifecycle, cancellation, runtime, streaming buffers
- `packages/ai`: provider interface, OpenAI-compatible streaming, errors, limits
- `packages/indexing`: inventory, symbols, imports, git context, ranked search
- `packages/context`: budgeted context assembly and untrusted-content wrapping
- `packages/tools`: workspace/tests/git tools, command execution, change service
- `packages/security`: permission policy, redaction, validation
- `packages/database`: SQLite schema and repositories
- `docs/development`: audits, phase plans, and the Phase 4 implementation report

## Documentation

- `docs/development/phase-4-audit-and-plan.md` — audit, duplicate findings, plan
- `docs/development/phase-4-implementation-report.md` — what shipped, how it is
  verified, and the remaining limitations

## Security baseline

Renderer code has no direct Node.js access. Every IPC payload is validated
against an explicit schema, workspace paths are resolved through a single
containment check, agent tool calls pass one permission authority, and file
changes are hash-checked, staged, and only then applied. Commands and file
mutations require explicit approval outside `auto` mode; commit/push is never
performed automatically.
