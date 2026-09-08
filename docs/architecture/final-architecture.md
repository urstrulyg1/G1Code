# Final Architecture

## Boundaries

The renderer is an unprivileged view. All filesystem, process, provider-key, database, and approval decisions remain in Electron main-process services. The preload bridge exposes typed, validated capabilities only.

The application is organized into these responsibilities:

- `packages/ai`: provider contracts, streaming, deterministic test providers, and normalized provider errors.
- `packages/agent`: bounded orchestration state machine, persistent events, cancellation, approvals, tests, repair, and final summaries.
- `packages/tools`: workspace-safe tools, command execution, Git reads, and the authoritative ChangeService.
- `packages/database`: versioned SQLite migrations and repositories for sessions, events, changes, indexes, test runs, baselines, and summaries.
- `packages/indexing`: incremental file metadata, symbols, imports, ranked file/symbol search, and watcher invalidation.
- `packages/context`: prioritized, hashed, deduplicated, bounded context assembly and task memory.
- `packages/testing`: project detection, related-test discovery, targeted execution, streamed results, and failure normalization.
- `apps/desktop`: Electron security boundary, IPC authorization, React workbench, timeline, diff review, sessions, and terminal.

## Agent lifecycle

```text
UNDERSTANDING -> ANALYZING -> PLANNING -> EXECUTING
  -> WAITING_FOR_CHANGE_APPROVAL -> EXECUTING
  -> TESTING -> VERIFYING -> REVIEWING -> COMPLETED
```

Failures enter `DIAGNOSING` and then bounded `REPAIRING` attempts. Every transition is persisted with session ID, timestamp, state, and evidence. Restart never resumes execution automatically.

## Change lifecycle

```text
PROPOSED/PENDING -> APPROVED -> APPLYING -> APPLIED -> REVERTED
                 -> REJECTED
                 -> CONFLICT
```

Proposal is non-mutating. Apply is the only AI filesystem mutation and verifies the original hash immediately before writing.

## Repository and context

Workspace startup performs incremental metadata reconciliation. Unchanged files are skipped by mtime/size/hash; changed files update metadata and symbols; deleted files are removed. Search reads persisted index data first. Context assembly ranks user request, task state, pending changes, failures, relevant source/tests, Git state, and instructions while deduplicating file hashes and reserving output budget.

## Validation

The product is complete only when unit, integration, security, and real Electron fixture tests execute the approval, targeted-test, failure-repair, restart, conflict, and final-summary workflows. Dependency upgrades and Electron E2E results are recorded rather than inferred.
