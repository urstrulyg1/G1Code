# ADR-0013 — Patch engine + checkpoints for all AI writes

**Status:** Accepted  
**Date:** 2026-09-07

## Context

Agents that `fs.writeFile` the whole buffer cause silent data loss, unreviewable diffs, and un-revertible sessions. Users (correctly) distrust this.

## Decision

AI **never** overwrites a file as a raw blob from model output.

Pipeline:

```text
Model edit proposal
  → Patch (unified diff / structured edit)
  → Validate (parse, encoding, path policy)
  → Preview (diff editor)
  → Apply (atomic, with backup)
  → Checkpoint (restore point)
```

Before a *task* that may touch more than N files or any destructive git/terminal action: **create a checkpoint** (git stash-like snapshot or worktree, implementation detail — interface is `CheckpointStore`).

User operations: Rollback, Restore, Compare, Continue.

## Alternatives

Direct write (fast, unsafe). Always-commit (pollutes git). Shadow copies without a patch (cannot review).

## Reason

Reviewability is a product feature, not a setting. Autonomous mode still uses patches; “auto-approve” skips the *prompt*, not the *patch*.

## Consequences

- Composer, inline Cmd/Ctrl+K, and coding agents share one patch engine.
- Binary files are not patched by models.
- Checkpoints need disk budget and GC policy.
