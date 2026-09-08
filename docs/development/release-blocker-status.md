# Release Blocker Status

| Finding | Current implementation | Current risk | Planned fix | Test | Status | Evidence |
| -- | -- | -- | -- | -- | -- | -- |
| Multi-file non-atomic apply | `ChangeBatch` journal, all-file preflight, temporary files, atomic renames, rollback, startup reconciliation | Crash during replacement can still produce ambiguous filesystem state; no renderer batch recovery UI | Add crash injection and affected-file review UI | `tests/change-batch.test.ts` | Partially fixed | 27-test suite passes; batch integration tests pass |
| Apply crash recovery | Active batches reconcile original/proposed/ambiguous hashes at startup | Ambiguous state is marked `PARTIAL_FAILURE`, but recovery cannot guarantee rollback after arbitrary OS crash | Add atomic backup journal and crash injection at each replacement boundary | Pending | Open P1 | Code path exists in `ChangeService.recoverActiveBatches` |
| Shell command security | Structured executable execution for supported test projects; arbitrary shell remains available | Shell interpretation and inherited environment remain broad authority | Restrict agent shell mode, add platform process-tree tests, explicit environment policy | Structured command/timeout tests pass | Partially fixed | `tests/command.test.ts` |
| Exact agent resume | Durable checkpoint stores last state and safe next action, explicitly `resumable: false` | Exact provider conversation cannot resume after restart | Persist deterministic conversation/tool checkpoint and reconcile idempotent operations | Pending | Open P1 | Checkpoint schema/runtime integration exists |
| IPC matrix | Shared primitive validators and route checks | Full malformed/replay/cross-session matrix not complete | Add handler-level integration tests for every route | Validator tests pass | Open P1 | `tests/validation.test.ts` plus authorization tests |
| Provider-driven repair | Runtime persists failed test evidence and bounded repair attempts | Diagnosis/proposal remains model-dependent and not fully provider-scenario tested | Add deterministic invalid-tool/dangerous-command/provider-repair scenarios | Golden workflow passes | Open P1 | `tests/golden-workflow.test.ts` |
| Electron E2E | Smoke harness accurately checks binary availability | Electron platform executable unavailable | Repair install/cache/network and run real renderer/main suite | `npm run e2e:smoke` | BLOCKED | Reports missing `node_modules/electron/dist` executable |
| Dependencies | Audit reviewed; no forced upgrades | 6 known findings, including 3 high | Deliberately upgrade Electron/Vite and revalidate launch/E2E | `npm audit` | Open P1 | 1 low, 2 moderate, 3 high |

## Current Evidence

```text
npm install       PASS
npm test          PASS — 27 tests
npm run build     PASS
Golden workflow   PASS
Electron E2E      BLOCKED
npm audit         6 vulnerabilities
```

## Release Decision

```text
NOT RELEASE READY
NOT FULLY VALIDATED
```
