# Audit Remediation Plan

## P1 Security/Data Integrity

| Problem | Root cause | Files | Fix | Regression test | Status |
| -- | -- | -- | -- | -- | -- |
| Legacy index data is stranded | Migration renames old table without mapping rows | `packages/database/connection.ts` | Design workspace ownership migration or explicit rebuild with preserved backup | Migration upgrade test | Open |
| Shell commands have broad authority | `sh -lc`/`cmd /c` execution | `packages/tools/command.ts`, Electron main | Structured commands for agent; explicit user-only shell mode; environment policy | Injection/process-tree tests | Open |
| Multi-file apply can partially succeed | Sequential writes without journal | ChangeService/runtime | Preflight, temp files, rollback journal, explicit batch status | `tests/change-batch.test.ts` | Fixed; crash injection remains |
| Apply can remain APPLYING | Unhandled filesystem failure after state update | `packages/tools/change-service.ts` | Catch/reconcile current hash and persist apply error | Crash/write-failure test | Open |
| Electron unavailable | Platform binary absent | npm/Electron environment | Repair CI install/cache/network and run desktop suite | Launch E2E | Blocked |
| Restart cannot continue exact task | Conversation/waiter memory is process-local | `packages/agent/runtime.ts` | Persist safe non-resumable checkpoint now; implement deterministic replay later | Checkpoint persistence/integration | Partially fixed; exact replay open |

## P2 Correctness/UX/Performance

- Add framework-aware test result parsing and hard test timeouts.
- Automatically select targeted tests after approved changes.
- Add prompt-injection trust boundaries and secret-aware context filtering.
- Add file watchers with debounce and worker-based indexing.
- Add complete malformed IPC and crash/concurrency suites.
- Add crash injection for batch replacement and rollback.
- Add plan editor, full diff navigation, Git panel, Problems panel, and testing panel.

## Validation Commands

```bash
npm install
npm test
npm run build
git diff --check
npm run e2e:smoke
```

## Current Status

The hostile audit regression suite passes at 22 tests after the current fixes. The release remains blocked by the open P1 items and unavailable Electron binary.
