# Implementation Roadmap

## Phase 0: architecture

Completed in this repository. Establish boundaries, threat model, state machine, provider contract, persistence model, UI composition, and roadmap.

## Phase 1: IDE shell

Current deliverable: Electron window, secure preload bridge, folder picker, recursive-ready file explorer API, editable file tabs, terminal command execution, status bar, command palette, and settings surface. Remaining hardening includes streaming terminal processes and native secure credentials.

## Phase 2: provider and agent core

Completed across the Phase 2 increments: provider interfaces, configurable OpenAI-compatible transport boundary, model discovery, streaming, normalized errors, retry/rate-limit handling, secure key storage, settings, tool registry, workspace tools, agent modes, bounded loop, streamed events, approval prompts, SQLite session/event repositories, managed cancellation, guarded changes, command spawning, read-only Git tools, repository metadata scanning, and context budgeting. Experimental Labs remains pending verified public API documentation. The remaining UI integration and end-to-end hardening are tracked in `docs/development/phase-2-hardening.md`.

## Phase 3: agentic coding loop

Persisted sessions, model selection, bounded runtime, durable change proposals, asynchronous approval, unified diff review, safe apply/revert, conflict handling, session restoration, and streamed command activity are implemented incrementally. Targeted test selection, repair, and full Electron E2E remain follow-up work.

## Phase 4: tools and permissions

Add audited read/search/list/write/command tools, path validation, permission prompts, and structured patch application.

## Phase 5: agent runtime

Implement bounded state machine, planning approval, tool loop, observation compression, verification, failure recovery, and Ask/Plan/Agent modes.

## Phase 6: repository intelligence

Add incremental file/symbol/import index, project detection, `.g1code` memory, relevance ranking, diagnostics, and context budgeting.

## Phase 7: Git and testing

Add read-only Git views first, then confirmation-gated mutations, test/build detection, targeted test loops, diff review, and recovery behavior.

## Phase 8: production hardening

Add crash recovery, extension API, LSP integrations, diagnostics export, performance work, packaging, installer, auto-update design, and end-to-end temporary repository tests.

## Phase 3.2 status

The single-agent approval boundary is durable and asynchronous. Edit proposals pause the runtime, persist in SQLite, and resume only after a session/workspace-authorized main-process decision. Project detection, targeted test discovery, and a streaming test runner are present. Full Electron E2E, model-driven repair, Git baseline comparison, context deduplication, and symbol indexing remain before the complete autonomous coding loop is considered done.

## Phase 1 acceptance criteria

- Launches as a desktop process with renderer isolation.
- Opens a local folder and displays its files.
- Opens and edits text files, saving through the main process.
- Runs a user-entered command in the workspace and displays its real output/exit code.
- Provides visible agent/settings surfaces without claiming AI functionality that is not connected.
