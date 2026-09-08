# G1Code Product Status

## Implemented

- Electron + React + TypeScript desktop shell with isolated preload bridge.
- Workspace-scoped file explorer, editor tabs, terminal, sessions, and agent activity UI.
- OpenAI-compatible streaming provider abstraction and encrypted API-key storage.
- Bounded agent runtime with streamed provider/tool events and cancellation states.
- Durable ChangeService with pending, approval, apply, conflict, revert, and rejection states.
- Non-mutating AI edit proposals with original/proposed content, SHA-256 hashes, and unified diffs.
- Main-process session/workspace authorization for change actions.
- Restart-safe interrupted sessions and explicit Review, Resume, and Discard controls.
- Safe real-path workspace validation, including symlink escape rejection.
- Persisted SQLite sessions, messages, tool calls, events, changes, baselines, files, and symbols.
- Versioned schema migration path from the original file-change schema.
- Incremental repository metadata/symbol indexing service and symbol search IPC.
- TypeScript/JavaScript/Python/basic multi-language symbol extraction with graceful regex fallback.
- Ranked file search foundation and hash-aware context deduplication.
- Project/test detection for npm, Maven, Gradle, Go, Cargo, Python, and Make.
- Related-test discovery, targeted command selection, streamed test execution, and structured results.
- Agent `run_tests` tool with permission gating and real command evidence.
- Bounded five-attempt test-failure repair guard.
- Deterministic provider and broken calculator fixture for tests.
- Git baseline capture at session start.
- Persisted test runs, repair attempts, task memory/summary schema, and evidence-derived completion summaries.
- Durable multi-file ChangeBatch journal with all-file preflight, temporary preparation, rollback, and startup reconciliation.
- Structured executable test commands with conservative command-risk classification and timeouts.
- Execution checkpoints that persist state and explicitly mark exact replay as unsafe until deterministic replay exists.
- Golden deterministic workflow covering insufficient first fix, real test failure, repair proposal, approval, repair apply, and passing retest.
- Symlink, cross-session, cross-workspace, change lifecycle, runtime approval, indexing, context, and repair tests.

## Architecture

The renderer is unprivileged and uses preload capabilities. Electron main owns filesystem access, command execution, SQLite, provider keys, workspace authorization, and change approval. AI edits flow through `ChangeService`; proposal never writes files, and apply verifies the original hash immediately before writing.

The agent is a bounded state machine. Approval is asynchronous and durable. Testing is deterministic local infrastructure and is exposed to the agent through a permission-gated tool. Repository indexing and context selection are local operations and do not require model calls.

## Agent lifecycle

Implemented states include:

```text
IDLE
UNDERSTANDING
ANALYZING
PLANNING
EXECUTING
WAITING_FOR_CHANGE_APPROVAL
OBSERVING
TESTING
DIAGNOSING
REPAIRING
VERIFYING
COMPLETED
FAILED
CANCELLED
STOPPED
INTERRUPTED
```

State persistence is present for session transitions emitted by the runtime. Full restart reconstruction of an in-flight provider conversation is intentionally not automatic.

## Security model

- `contextIsolation: true`
- `nodeIntegration: false`
- Sandboxed renderer preload
- Workspace lexical and real-path containment
- Session/workspace-bound change authorization
- Persisted change content loaded only by main process
- API keys kept out of renderer and logs
- Command and test execution permission-gated
- Bounded command output and agent execution

## Repository intelligence

The index stores workspace-scoped file metadata and symbols. Unchanged files are skipped using metadata/hash comparison. Deleted paths are removed. Symbol search is persisted and exact matches rank first. Current extraction is intentionally lightweight and does not provide a full language-server reference graph.

## Context system

`ContextIntelligence` tracks content hashes per path and suppresses unchanged file content. `ContextBudgetManager` prioritizes parts and applies a character budget. Full token accounting, conversation compaction, summarization, and task-memory persistence remain incomplete.

## Change system

AI changes are persisted before approval. The UI shows actual unified diffs. Per-file and batch approval are available. Conflicts are never silently retried or overwritten. Revert checks the applied content hash and refuses to overwrite subsequent user changes.

## Testing system

The testing package detects project type, identifies related test files, selects targeted commands, streams stdout/stderr, and returns `executionSucceeded`, `testsPassed`, exit code, and raw bounded results. A failed test command is evidence for model diagnosis, not an infrastructure exception by itself.

## Self-repair

The runtime recognizes failed `run_tests` results, persists bounded repair attempts, emits diagnostic/repair states, and enforces a maximum of five attempts. The deterministic golden workflow proves an insufficient first change can be followed by an approved repair and passing retest. Free-form provider-driven diagnosis remains dependent on the model producing the next proposal.

## Git integration

Session-start branch, HEAD, status, and diff are captured in SQLite. File attribution distinguishes baseline-only, agent-only, and overlapping files for persisted summaries. Autonomous commits are not supported.

## E2E coverage

Unit and integration-style tests cover the change service, runtime pause/resume, authorization, symlink protection, indexing/context, testing detection, repair bound, Git attribution, and the golden autonomous coding workflow. A real Electron E2E suite has not passed. Electron smoke launch was attempted and failed because the local Electron package was incomplete:

```text
Electron failed to install correctly, please delete node_modules/electron and try installing again
```

No Electron E2E success is claimed.

## Dependency status

`npm audit` currently reports six findings: one low, two moderate, and three high. The high findings involve Electron/Vite transitive or direct upgrades that require major-version changes. No forced audit fix was applied. Electron installation was investigated: npm 11 listed the Electron postinstall script as unapproved, and the package had no `dist` binary. Approval/rebuild and direct `install.js` execution were attempted, but the binary remained unavailable in this environment.

## Validation

The latest local validation is:

```text
npm install       passed
npm test          17 tests passed
npm run build     passed
git diff --check  passed
```

Golden workflow:

```text
PASS  tests/golden-workflow.test.ts
```

Electron launch:

```text
BLOCKED  Electron platform executable unavailable in this environment
```

## Known limitations

- Full Electron E2E is blocked by the incomplete local Electron installation; code-level golden workflow passes.
- Multi-file batch recovery is covered at the integration level; crash injection and renderer batch UX remain.
- The renderer remains a compact workbench, not a Monaco-based full IDE experience.
- Provider-driven repair proposals still depend on the model producing the next tool call after diagnostic evidence; the deterministic repair scenario is complete.
- Full context compression, reference indexing, diagnostics, and malformed IPC matrix coverage remain.
- Existing human terminal/file-write handlers are separate from the AI ChangeService boundary and need additional policy unification.

## Build and test

```bash
npm install
npm test
npm run build
git diff --check
```
