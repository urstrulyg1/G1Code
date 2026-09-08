# Actual End-to-End Flow

## Current connected path

```text
Renderer prompt
  -> preload agent:start
  -> Electron runtime validates selected workspace and provider
  -> DatabaseStore creates RUNNING session and captures Git baseline
  -> AgentRuntime streams provider output
  -> ToolRegistry executes workspace/Git/testing tools
  -> write_file/apply_patch call ChangeService.proposeChange
  -> SQLite stores PENDING content, hashes, and unified diff
  -> AgentRuntime waits in WAITING_FOR_CHANGE_APPROVAL
  -> renderer loads persisted change and shows diff
  -> preload agent:change / approve-all
  -> main process authorizes session/workspace and applies hash-safe change
  -> waiter resolves and the same AgentRuntime conversation resumes
  -> run_tests detects project and related tests, asks command permission,
     streams stdout/stderr, and returns structured evidence
  -> AgentRuntime emits DIAGNOSING/REPAIRING for failed test results and
     stops after five failures
  -> agent events, tool calls, changes, and session status persist in SQLite
```

## Renderer and IPC

The renderer does not access SQLite or the filesystem. `preload.ts` exposes workspace, settings, sessions, changes, index, and agent operations. Main-process handlers validate input and authorize the selected workspace. Approval actions now include the session ID and are checked against the persisted change owner.

## Persistence

Sessions, messages, tool calls, events, changes, Git baselines, file metadata, and symbols are persisted. The approval waiter itself is in memory, so a process restart cannot resume an in-flight provider conversation. Startup marks active sessions interrupted; pending changes remain reviewable and can be safely rejected or applied after authorization.

## Actual gaps

- The renderer does not yet provide a full plan editor or testing/Git/problems workbench.
- Test runs and repair attempts are being connected to durable records in this sprint.
- A real Electron E2E harness requires a valid Electron binary installation; unit/integration tests do not substitute for it.
- The existing runtime lets the model request `run_tests`; automatic post-approval test orchestration and repair proposal history are not inferred from events until the new persistence integration is active.
