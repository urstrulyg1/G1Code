# Phase 3 Approval Flow

## Audited behavior

Before Phase 3.1, an edit tool called `ChangeService.proposeChange`, then invoked the generic Electron permission callback. When the renderer allowed the request, the tool called `approveChange` and `applyChange` itself before returning a successful tool result. The filesystem therefore changed during the permission prompt, and the persisted `PENDING` state was only transient.

## Durable behavior

The edit boundary is now split into two operations:

```text
agent tool call
  -> ChangeService.proposeChange
  -> SQLite PENDING change
  -> pending_approval tool result
  -> AgentRuntime WAITING_FOR_CHANGE_APPROVAL
  -> renderer reviews persisted unified diff
  -> validated main-process approval/rejection
  -> ChangeService apply or reject
  -> approval waiter resolves
  -> AgentRuntime resumes the same tool-call loop
```

`proposeChange` never writes the filesystem. Only `applyChange` can do so, and it verifies the original hash immediately before writing. A conflict transitions to `CONFLICT` and leaves the current file untouched.

Approval decisions are authorized in the main process using the persisted change, its session, and the selected workspace. Renderer input supplies only a change ID and action; it cannot supply content, paths, or hashes.

On application restart, active sessions are marked `INTERRUPTED`. Pending changes remain in SQLite and are shown for review. No pending tool call or command resumes automatically.
