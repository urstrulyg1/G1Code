# G1Code Production Audit

## Executive Summary

This audit inspected the Electron main/preload/renderer boundary, agent runtime, ChangeService, SQLite setup, workspace security, command execution, provider streaming, indexing, context, testing, Git baseline, and UI persistence paths. The deterministic golden workflow is useful evidence, but it covers one in-process path and does not prove production readiness.

The remediation pass fixed several concrete defects: duplicate change decisions now use compare-and-set transitions, multi-file apply has a durable batch journal with preflight and rollback, startup reconciles active batches, final-file symlink replacement is rejected, command cancellation targets Unix process groups, supported tests use structured executable arguments with timeouts, command child environments redact secret-like variables, secret-like files are excluded from indexing, and SQLite foreign-key enforcement is enabled. Regression coverage increased to 26 tests.

The release decision remains `NOT RELEASE READY` and `NOT FULLY VALIDATED` because there are unresolved P0/P1 data-integrity/security/reliability issues and Electron cannot launch in the current environment.

## Release Blockers

| ID      | Severity | Category          | Component         | Finding                                                                                                                                                                                                                    | Evidence                                                                                                                                               | Fix                                                                                                                                                                                               |
| ------- | -------- | ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-001 | P1       | DATA INTEGRITY    | SQLite migration  | Existing legacy `files` data is preserved in `legacy_index_files` but still has no workspace owner and is not automatically reattached. The active index is empty until rebuild.                                           | `packages/database/connection.ts`, migration around `ALTER TABLE files RENAME TO files_legacy`                                                         | Add a real migration that maps legacy rows to a workspace owner or makes the rebuild/invalidated state user-visible. Never silently present an empty index.                                       |
| AUD-002 | P1       | SECURITY          | Command execution | Agent and renderer command paths execute through `sh -lc`/`cmd /c`. Permission gates reduce risk but shell metacharacters remain fully active after approval. The direct human terminal inherits main-process environment. | `packages/tools/command.ts`, `apps/desktop/electron/main.ts`                                                                                           | Use structured executable/argument execution for inferred tools; isolate the environment; make arbitrary shell terminal explicitly user-only and disclose inherited environment risk.             |
| AUD-003 | P1       | DATA INTEGRITY    | ChangeService     | Multi-file application required durable transaction-like recovery.                                                                                                                                                         | Fixed with `change_batches`, `change_batch_items`, all-file preflight, temp preparation, atomic rename, rollback journal, and `PARTIAL_FAILURE` state. | Add crash injection/Electron batch UI coverage.                                                                                                                                                   |
| AUD-004 | P1       | RELIABILITY       | ChangeService     | If filesystem write throws after status becomes `APPLYING`, the record can remain `APPLYING`. Startup converts it to `CONFLICT`, but there is no evidence whether bytes were partially written.                            | `packages/tools/change-service.ts` `applyChange`                                                                                                       | Catch all apply errors, inspect current hash, transition to `CONFLICT`/`FAILED_APPLY`, persist reason, and use atomic temp-file rename.                                                           |
| AUD-005 | P1       | RELIABILITY       | Electron          | Real Electron launch and renderer/main E2E remain blocked because `node_modules/electron/dist` has no executable.                                                                                                          | `npm run e2e:smoke` reports missing platform binary                                                                                                    | Repair dependency installation/cache/network in CI and validate launch before release.                                                                                                            |
| AUD-006 | P1       | AGENT RELIABILITY | Restart           | Exact provider continuation remains unsafe, but the last runtime state and safe next action were not previously persisted.                                                                                                 | `packages/agent/runtime.ts`, in-memory `messages` and waiters                                                                                          | Partial fix: execution checkpoints now persist state and `resumable: false`; exact conversation continuation remains intentionally disabled until deterministic checkpoint replay is implemented. |

## Critical Bugs

No confirmed P0 was found during this pass. The P1 items above are release blockers because they can cause data integrity loss, privilege expansion, or unverifiable desktop behavior.

## Security Findings

- `contextIsolation`, `nodeIntegration: false`, and sandboxing are enabled in `apps/desktop/electron/main.ts`.
- Change approval is session- and workspace-bound in `ChangeService.authorizeChange` and runtime IPC.
- `safeRealPath` now rejects existing final symlinks that resolve outside the workspace.
- Indexing excludes `.env`, credential-like names, private key extensions, and RSA key names.
- Repository content is still passed into model context when selected by tools. There is no centralized prompt-injection/trust policy or secret redaction layer for arbitrary read results.
- Project instructions are loaded into the system-adjacent prompt in `runtime.ts`; the trust hierarchy is not represented as separate untrusted content. A malicious instruction file can influence model behavior, although it cannot directly bypass main-process authorization.
- The renderer-controlled `file:write` handler is a separate privileged write path and bypasses ChangeService. This is appropriate for explicit human editor saves only if the distinction is documented and enforced; it must never be reused for agent writes.

## Data Integrity Findings

- Change status transitions were previously read-then-write and race-prone. Compare-and-set transitions were added for approval, rejection, apply, and revert entry.
- Apply writes directly to the target file. There is no atomic temp-file replacement or write journal.
- SQLite has no `PRAGMA foreign_keys = ON`; declared foreign keys are therefore not enforced by the connection.
- Most tables lack foreign keys, uniqueness constraints, or deletion policy. Deleting a session can leave messages, changes, events, tests, and baselines orphaned.
- Task summary generation is asynchronous from terminal state emission. A crash between state update and summary write can leave a completed session without a summary.

## Agent Runtime Findings

- Tool and iteration limits exist, and failed test results are bounded to five repair attempts.
- The repair guard records a failure attempt but does not itself generate a model diagnosis or repair proposal. That still depends on the provider producing a later tool call.
- `WAITING_FOR_CHANGE_APPROVAL` uses in-memory promises. Restart correctly avoids automatic continuation but cannot reconstruct the exact provider conversation.
- Cancellation sets runtime state and aborts the manager controller, but approval waiters are not universally resolved by cancellation unless discard is used.
- Tool calls are persisted from emitted events, but event-driven persistence can produce a started record without a terminal result if the process crashes.

## ChangeService Findings

- Invalid lifecycle transitions are rejected.
- Duplicate approval/apply races are now covered by compare-and-set status transitions.
- Conflict protection checks current content hash and content equality.
- Existing symlink targets are now canonicalized before read/apply/revert.
- Multi-file operations are not atomic.
- Apply failures can strand `APPLYING` state and lack a durable error reason.
- Binary files are read as UTF-8 and have no explicit binary policy.
- Create/delete/rename are not first-class change operations; they are represented as write content only.

## Persistence Findings

- SQLite uses WAL, but foreign key enforcement is not enabled.
- Migration versioning exists but is not a robust migration framework: DDL is mixed with startup creation, errors are swallowed for ALTER statements, and legacy index rows are stranded.
- No database backup/recovery strategy exists.
- Test output and source content can persist indefinitely without retention controls.

## IPC Findings

- Public handlers now have basic type/length checks for paths, commands, settings, actions, sessions, and workspaces.
- Approval actions verify persisted session/workspace ownership.
- `agent:sessions`, index, session, and change handlers still duplicate validation logic rather than using one contract layer.
- There is no complete automated matrix for every IPC route with null, arrays, oversized values, replay, or stale sessions.
- IPC errors expose raw messages to the renderer; there is no normalized user-safe error envelope with technical details separated.

## Electron Findings

- BrowserWindow isolation settings are correct in source.
- Package `main` now matches the generated Electron output path.
- Electron binary installation is unavailable in the current environment. No renderer-level behavior has been verified.
- No navigation policy, new-window policy, or permission handler audit was found for future remote content.

## Filesystem Findings

- Workspace containment is lexical plus real-path based.
- Existing final-file symlink replacement is now rejected and covered by tests.
- Broken symlink/new-file handling requires additional cases; parent canonicalization is defensive but not an atomic authorization/write operation.
- File permissions and ownership are not preserved or checked during apply/revert.
- Large-file limits exist for reads but not consistently for proposed changes, diffs, indexing, or renderer display.

## Terminal Findings

- Agent commands stream output through `spawnCommand` and now cancel Unix process groups.
- Shell execution remains a fundamental injection surface for arbitrary shell mode. Supported test commands now use structured executable/argument execution; approval is still the primary control for arbitrary shell commands.
- Direct human terminal uses a separate `execFile` shell path and does not stream or process-group cancel.
- Child environments are filtered for names containing secret-like terms, but this is heuristic and may remove required variables while missing nonstandard secrets.
- Command timeout and cancellation do not guarantee descendants on Windows.

## Testing Findings

- Detection, related-test selection, streaming, structured results, and persisted test runs exist.
- Tests with exit code zero but failure text are treated as passed; no framework-specific output parser exists.
- Structured test commands now have a 120-second timeout and process cancellation. Arbitrary shell commands still require stronger platform-specific process-tree guarantees.
- Targeted test escalation is not automatically orchestrated by the runtime after approval; the model generally must request `run_tests`.

## Repair Loop Findings

- Five-attempt bound is tested and prevents a sixth `run_tests`-failure iteration.
- Repair history persistence exists.
- Model-driven root-cause classification is not enforced; environment/dependency failures can still be presented as source failures to the model.
- Repair scope is not mechanically restricted to changed/relevant files.
- Rejected repair does not have a dedicated terminal policy beyond returning a tool result.

## Git Findings

- Baseline branch, HEAD, status, diff, and modified paths are captured.
- Basic agent/pre-existing/overlap attribution exists.
- Untracked files, renames, staged-vs-unstaged content, merge conflicts, detached HEAD, and no-Git workspaces need deeper handling.
- Final attribution is path-based and can misclassify a file changed by both a user and agent after baseline.

## Repository Intelligence Findings

- Indexing is metadata/hash incremental and workspace-scoped.
- There is no file watcher despite the product requirement; changes are detected only on explicit rebuild/startup.
- Symbol extraction is regex-based and can match declarations inside strings/comments or miss nested/overloaded constructs.
- No imports, exports, references, implementations, or call graph are persisted.
- Search may read files repeatedly and has no secret-aware context enforcement beyond index exclusions.

## Context/Memory Findings

- Hash deduplication, priority budgeting, and compact task summaries exist.
- Budgeting is character-based rather than model-token based.
- The runtime does not actually assemble ranked repository context before provider calls; tools still supply observations opportunistically.
- Compression is a formatter, not an automatic conversation compactor integrated into the provider loop.
- Secret filtering is not centralized for model context.

## UI/UX Findings

- Persisted test/repair evidence is visible.
- The UI is still a compact shell: no professional Git panel, Problems panel, plan editor, inline/side-by-side Monaco diff, test failure navigation, or event detail view.
- The renderer has no robust error boundary or normalized technical-details UX.
- Many asynchronous buttons do not disable during action, so duplicate clicks remain possible at the UI layer even where backend CAS rejects them.
- Keyboard shortcuts do not cover accept/reject/run tests/navigation comprehensively.

## Performance Findings

- Repository scanning reads and hashes files sequentially and can block the main process for large repositories.
- Indexing is triggered from the main process without a worker.
- SQLite writes are synchronous `better-sqlite3` calls on the main process.
- Diff and test output limits are incomplete for all renderer paths.
- No large-repository or large-file performance measurements exist.

## Dependency Findings

Current audit reports:

```text
1 low
2 moderate
3 high
```

High findings affect Electron, Vite/esbuild, and Electron's `extract-zip` dependency. Fixes reported by npm require major upgrades. No blind force upgrade was performed. Electron binary installation is separately blocked in the current environment.

## Test Coverage Gaps

- No real Electron launch/renderer E2E.
- No crash injection during apply/test/repair.
- No concurrent session filesystem race suite.
- No atomic multi-file failure suite.
- No SQLite migration upgrade/rollback suite.
- No process-tree cancellation suite.
- No prompt-injection fixture execution through a real provider loop.
- No comprehensive IPC route matrix.
- No large repository/file stress suite.

## Product Gaps

- Automatic post-approval test orchestration.
- Full provider-driven repair proposal workflow.
- Restartable provider conversation checkpoints.
- Plan approval/edit/regeneration.
- Review/debug/refactor modes.
- Reference search and semantic symbol graph.
- Full Git panel and final attribution UI.
- Full professional diff and problems/test panels.

## Recommended Fix Order

1. Repair migration data preservation and enable SQLite foreign keys.
2. Make apply atomic/recoverable and define multi-file batch policy.
3. Replace or isolate shell command execution and add process-tree tests.
4. Add durable provider checkpoints and approval waiter recovery.
5. Fix Electron install in CI and run real renderer/main E2E.
6. Add secret-aware context/prompt-injection policy.
7. Add test timeouts, framework result parsing, and automatic targeted escalation.
8. Add complete IPC/security/crash/concurrency test matrices.
9. Move indexing and large SQLite work off the main thread.
10. Complete plan, diff, Git, Problems, and testing UI.

## Release Decision

`NOT RELEASE READY`

`NOT FULLY VALIDATED`

Reasons: P1 migration/data-integrity risk, P1 shell/process security risk, P1 non-atomic multi-file apply, incomplete crash recovery, and blocked Electron E2E.

## Scorecard

| Area                    | Score |
| ----------------------- | ----: |
| Architecture            |     7 |
| Security                |     5 |
| Agent reliability       |     5 |
| Change safety           |     6 |
| Persistence             |     5 |
| Repository intelligence |     5 |
| Context management      |     5 |
| Testing                 |     6 |
| Self-repair             |     4 |
| Git integration         |     5 |
| Electron reliability    |     2 |
| IPC security            |     6 |
| Performance             |     4 |
| UX                      |     4 |
| Observability           |     5 |
| E2E coverage            |     2 |

Scores below 8 reflect unvalidated Electron behavior, incomplete recovery/atomicity, and missing product-level orchestration rather than lack of unit primitives.
