# G1Code 360 Product Scorecard

**Audit date:** 2026-09-08  
**Repository commit baseline:** `159a0b0f379fe4f1dd224cdab6646154809e3884`  
**Working tree:** Dirty; remediation changes are uncommitted  
**Tests:** `npm test` PASS, 26 tests  
**Build:** `npm run build` PASS  
**Diff check:** PASS  
**Electron:** BLOCKED; platform executable is absent under `node_modules/electron/dist`  
**Dependency audit:** 6 findings: 1 low, 2 moderate, 3 high

## Overall Score

```text
G1Code Overall Score: 5.1/10
```

This is a risk-adjusted product score, not a raw feature average.

| Measure              |  Score |
| -------------------- | -----: |
| Technical capability | 6.4/10 |
| Reliability          | 4.8/10 |
| Security             | 5.6/10 |
| Product maturity     | 4.4/10 |
| Production readiness | 3.6/10 |
| Developer trust      | 5.0/10 |

The raw category average is approximately `5.4/10`. It is reduced because Electron has not launched, production dependencies have unresolved high findings, multi-file crash injection is not validated, exact agent resume is intentionally unavailable, and the renderer has not been tested against the real main process.

**Classification:** Early Product / usable technical prototype, not a production candidate.

## Master Scorecard

| Category                | Score | Confidence | Major gap                                                                         |
| ----------------------- | ----: | ---------- | --------------------------------------------------------------------------------- |
| Architecture            |  7/10 | HIGH       | Migration, lifecycle, and main-process coupling debt                              |
| Electron                |  2/10 | HIGH       | Binary unavailable; no real desktop E2E                                           |
| Security                |  5/10 | MEDIUM     | Shell authority, prompt injection, dependencies, no full IPC matrix               |
| Agent runtime           |  5/10 | HIGH       | Exact resume and full orchestration are incomplete                                |
| Autonomous coding       |  5/10 | HIGH       | Golden deterministic path passes; real provider/product path unvalidated          |
| Self-repair             |  4/10 | HIGH       | Bounded evidence loop exists; model-driven diagnosis is not mature                |
| Change safety           |  6/10 | MEDIUM     | Batch journal exists; crash injection and UI recovery remain                      |
| Persistence             |  5/10 | HIGH       | SQLite entities exist; migration/recovery/retention are immature                  |
| Repository intelligence |  5/10 | MEDIUM     | Incremental metadata and regex symbols; no references/watcher                     |
| Context                 |  5/10 | MEDIUM     | Hash dedup/budget/compaction exist; not integrated deeply into runtime            |
| Testing engine          |  6/10 | MEDIUM     | Detection and structured execution work; framework parsing/escalation incomplete  |
| Git                     |  5/10 | MEDIUM     | Baseline and basic attribution; edge cases and final UI incomplete                |
| Session recovery        |  4/10 | HIGH       | Safe restore state exists; exact resume does not                                  |
| UI/UX                   |  4/10 | HIGH       | Compact shell, limited diff/plan/Git/problems/testing surfaces                    |
| Performance             |  4/10 | LOW        | No large-repository or renderer performance measurements                          |
| Observability           |  5/10 | MEDIUM     | Persisted events/evidence exist; diagnostic export/detail views incomplete        |
| Privacy                 |  5/10 | MEDIUM     | Key isolation and filename filtering; context/retention policy incomplete         |
| Maintainability         |  5/10 | HIGH       | Clear packages but duplicated validation and dense main runtime                   |
| Extensibility           |  6/10 | MEDIUM     | Provider/tool/testing abstractions are usable; state/persistence coupling remains |
| E2E                     |  2/10 | HIGH       | Golden integration passes; Electron suite is blocked                              |
| Production readiness    |  3/10 | HIGH       | P1 risk and validation blockers remain                                            |
| Developer trust         |  5/10 | HIGH       | Approval/evidence strengths offset by restart/Electron gaps                       |

## Architecture

### Architecture — 7/10

**Evidence:** Separate `packages/ai`, `agent`, `tools`, `database`, `indexing`, `context`, `testing`, and Electron app layers exist. The preload bridge is narrow, and ChangeService is the AI-edit authority. The deterministic golden workflow exercises runtime, filesystem, change persistence, and testing together.

**Strengths:** Clear conceptual boundaries; provider/tool abstraction; durable change pipeline; main/renderer isolation; reusable testing/indexing packages.

**Weaknesses:** `apps/desktop/electron/runtime.ts` owns too much orchestration and persistence wiring. Validation is duplicated across IPC handlers. Human editor writes and agent writes use separate safety paths. Database migration, batch recovery, and runtime checkpointing are not isolated services.

**Recommended improvement:** Extract typed IPC contracts, batch recovery, session checkpointing, and task orchestration into focused main-process services. Keep renderer as a view over persisted state.

### Modularity — 6/10

Packages are separated, but `AgentRuntime` constructor dependency growth and Electron runtime callback wiring indicate increasing coupling.

### Separation of concerns — 6/10

ChangeService, testing, indexing, and provider concerns are reasonably separated. Main runtime still combines authorization, persistence, event projection, batch orchestration, and provider setup.

### Persistence architecture — 5/10

SQLite is central and useful, but migrations are ad hoc, foreign keys were only recently enabled, and recovery/retention policies are incomplete.

### Extensibility — 6/10

Adding providers/tools/project detectors is straightforward. Adding a new durable agent state or entity requires editing several coupled surfaces.

## Electron Architecture

### Electron — 2/10

**Evidence:** Source config enables `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. However, `npm run e2e:smoke` reports that the platform executable is unavailable. The application has not created a real window in this environment.

**Strengths:** Correct isolation intent; narrow preload; package entrypoint corrected.

**Weaknesses:** Startup is not validated; navigation/new-window policy is not comprehensively configured; no renderer/main E2E; dependency version is vulnerable.

**Recommended improvement:** Fix CI/local Electron installation, add real launch/window/IPC tests, explicitly deny uncontrolled navigation and new windows, then upgrade Electron deliberately.

### Electron sub-scores

| Area                | Score | Evidence                                                               |
| ------------------- | ----: | ---------------------------------------------------------------------- |
| Main process        |     5 | Real handlers exist, but untested in launched runtime                  |
| Renderer isolation  |     7 | Correct BrowserWindow flags in source                                  |
| Preload             |     6 | Narrow API, but no complete contract test                              |
| Sandboxing          |     7 | Enabled in source                                                      |
| Navigation security |     3 | No comprehensive navigation/new-window policy                          |
| IPC exposure        |     6 | Validation/authorization exists but duplicated and incompletely tested |
| Window lifecycle    |     4 | Basic activate/close handlers only                                     |
| Startup reliability |     2 | Electron binary unavailable                                            |
| Packaging readiness |     2 | No launch/package validation                                           |

## Security

### Overall Security — 5/10

The product has a good security direction and meaningful tests, but several boundaries remain broad or unvalidated.

| Area                        | Score | Evidence                                                 | Main weakness                                              |
| --------------------------- | ----: | -------------------------------------------------------- | ---------------------------------------------------------- |
| Filesystem security         |     7 | `safePath`, `safeRealPath`, symlink tests                | TOCTOU and permission edge cases remain                    |
| Path traversal              |     7 | Workspace containment tests                              | Full Windows/UNC/junction matrix absent                    |
| Symlink protection          |     7 | Parent and final-file symlink tests                      | Crash/replace races unvalidated                            |
| IPC security                |     6 | Validators and authorization tests                       | No full route-level matrix                                 |
| Session authorization       |     7 | Change session ownership checks                          | Other session APIs need consistent contract layer          |
| Workspace authorization     |     7 | Selected workspace checks                                | Repeated inline validation                                 |
| Command execution           |     5 | Structured test commands, risk classifier                | Arbitrary shell remains broad authority                    |
| Shell security              |     3 | Explicit shell distinction exists                        | Shell interpretation still enabled                         |
| Environment isolation       |     5 | Secret-name filtering                                    | Heuristic, not explicit allowlist                          |
| Secret handling             |     5 | Encrypted API key and secret file exclusions             | Output/context/retention scanning incomplete               |
| API-key protection          |     7 | Main-process `safeStorage`; no renderer key              | Electron runtime unvalidated                               |
| Prompt injection resistance |     3 | No central trust hierarchy enforcement                   | Repository/output instructions can influence model context |
| Repository trust boundaries |     3 | Content treated as context, not authority by design only | No systematic untrusted-content wrapper                    |
| Terminal-output trust       |     3 | Output passed as model evidence                          | No explicit instruction/data separation                    |
| Renderer security           |     7 | Isolation flags in source                                | No actual renderer E2E                                     |
| Electron security           |     3 | Old Electron with audit findings                         | No running validation                                      |
| Dependency security         |     3 | `npm audit` reports 3 high                               | Major upgrades pending                                     |
| Privacy/data retention      |     4 | SQLite persists source/diffs/output                      | No retention or redaction policy                           |

### Trust hierarchy

The intended hierarchy is:

```text
System security policy
> user request
> project instructions
> repository content
> tool output
> model suggestions
```

The implementation enforces security at the main-process tool boundary, but it does not yet encode this hierarchy strongly in context/message types. This is a material prompt-injection weakness.

## Agent Runtime

### Agent runtime — 5/10

**Evidence:** `AgentRuntime` has bounded iterations/tool calls/duration, approval waiters, streamed events, explicit cancellation states, failed-test repair bounds, and checkpoint persistence. Tests cover approval pause/resume and five-attempt stopping.

**Strengths:** Bounded loop; real tool results; cancellation propagation; approval is asynchronous; evidence persistence.

**Weaknesses:** Exact conversation resume is unavailable. Checkpoints currently use `resumable: false`. Tool persistence can be incomplete after a crash. Full state transition persistence and legal-transition enforcement are not centralized.

**Safe resume:** 5/10. It restores records and avoids unsafe automatic execution.  
**Exact resume:** 2/10. It cannot reconstruct the provider conversation and next safe tool operation.

### Agent sub-scores

| Area                  | Score |
| --------------------- | ----: |
| State machine         |     6 |
| Orchestration         |     5 |
| Tool validation       |     6 |
| Iteration/tool bounds |     7 |
| Timeouts              |     6 |
| Cancellation          |     6 |
| Error handling        |     5 |
| Retry behavior        |     4 |
| Failure recovery      |     4 |
| Persistence           |     5 |
| Checkpointing         |     4 |
| Restart behavior      |     5 |
| Observability         |     6 |

## Autonomous Coding

### End-to-end autonomous coding — 5/10

The deterministic golden workflow passes and proves a meaningful code-change/test/repair path. It does not prove the full real product path because Electron E2E and external-provider orchestration are unavailable.

| Capability                | Score | Evidence                                                           |
| ------------------------- | ----: | ------------------------------------------------------------------ |
| Requirement understanding |     5 | Prompt enters runtime; no structured requirement model             |
| Repository analysis       |     5 | Index/search/tools exist; not automatically assembled into context |
| Planning                  |     3 | Plan state exists; full plan approval/editor absent                |
| Context gathering         |     5 | Hash dedup/budget/index primitives                                 |
| Code generation           |     5 | Provider tool calls and deterministic workflow                     |
| Multi-file editing        |     6 | Durable changes and batch journal                                  |
| Proposal/approval         |     7 | Real persisted approval path                                       |
| Safe application          |     6 | Hashes, symlinks, batch preflight/rollback                         |
| Testing                   |     6 | Detection/selection/structured execution                           |
| Diagnosis                 |     3 | State and evidence exist; diagnosis is model-dependent             |
| Repair proposal           |     4 | Golden deterministic scenario; not fully provider-integrated       |
| Retesting                 |     5 | Real runner; runtime orchestration incomplete                      |
| Verification              |     4 | Evidence persisted, review incomplete                              |
| Final summary             |     5 | Evidence-derived summary schema exists                             |

## Self-Repair — 4/10

**Strengths:** Failed test evidence is persisted; attempts are bounded to five; repair states exist; golden scenario proves an insufficient first fix followed by a repair.

**Weaknesses:** Root-cause analysis is not enforced. Environment/dependency failures can still reach the model as generic test failures. Repair scope is not mechanically constrained. Provider-driven invalid tool/dangerous-command/repeated-failure scenarios are not fully validated.

**Recommended improvement:** Add structured failure classification, deterministic provider scenarios, repair scope checks, and persisted attempt-to-change relationships.

## Change Safety — 6/10

| Area                      | Score |
| ------------------------- | ----: |
| ChangeService authority   |     7 |
| Authorization             |     7 |
| Lifecycle                 |     6 |
| Persistence               |     6 |
| Hash validation           |     7 |
| Conflict detection        |     7 |
| Multi-file support        |     6 |
| Preflight                 |     7 |
| Temporary files           |     6 |
| Atomic replacement        |     6 |
| Rollback                  |     5 |
| Rollback verification     |     4 |
| Partial failure           |     5 |
| Crash recovery            |     4 |
| Revert                    |     6 |
| Concurrent approval/apply |     7 |
| Ownership/audit trail     |     5 |

### Multi-file transaction safety — 6/10

The design is **conditionally safe**, not transactionally atomic. It has preflight, journal records, temporary preparation, atomic per-file rename, rollback, and startup reconciliation. It does not provide an OS-level transaction across files, and crash injection has not proven every boundary. `PARTIAL_FAILURE` is possible and must remain visible.

## Persistence — 5/10

**Strengths:** Sessions, messages, tool calls, events, changes, tests, repairs, checkpoints, Git baselines, index records, and summaries are modeled.

**Weaknesses:** Migration behavior is immature; foreign-key enforcement is recent; there is no backup/corruption recovery strategy; retention is undefined; some writes are not transactionally coupled with filesystem operations.

### Database reliability — 5/10

SQLite WAL and transactions are used selectively. The schema can represent inconsistent or incomplete states during crashes, and the repair/reconciliation logic is partial. No corruption recovery or migration rollback suite exists.

## Repository Intelligence — 5/10

**Evidence:** Incremental metadata index, deleted-file reconciliation, symbol table, symbol search, ranked file search, project detection, and workspace startup rebuild exist.

**Gaps:** No file watcher, rename handling is weak, symbols are regex-based, no import/reference graph, no semantic implementations/call graph, and no large-repository measurements.

### Symbol intelligence

| Language   | Score | Assessment                                                      |
| ---------- | ----: | --------------------------------------------------------------- |
| TypeScript |     5 | Basic declarations; regex false positives/misses complex syntax |
| JavaScript |     5 | Same lightweight extraction                                     |
| Python     |     5 | Functions/classes by line-based regex                           |
| Go         |     3 | Basic `func`/struct patterns; no package semantics              |
| Rust       |     3 | Basic `fn`/struct/enum patterns; no traits/references           |
| C/C++      |     2 | Very limited patterns; no parser semantics                      |
| Java       |     2 | Extension detected, practical Java symbol extraction weak       |

### Search — 5/10

File/symbol search primitives exist and exact symbol ranking is present. Reference search, import-aware ranking, large-repository latency, and search-to-context/agent integration are incomplete.

## Context Intelligence — 5/10

**Strengths:** Hash deduplication, priority budget, compaction formatter, task-memory shape, repository metadata.

**Weaknesses:** Character budget rather than token accounting; runtime does not automatically assemble ranked repository context before every provider call; compression is not a true conversation compactor; secret-aware content filtering is incomplete; stale context comparison is not universally enforced.

## Free-tier Model Efficiency — 5/10

The architecture has the right direction: deterministic indexing, targeted tests, hashing, deduplication, bounded outputs, and local project detection. However, the runtime still relies on the model to request many inspection operations, and context assembly is not deeply integrated. Small/free models receive useful primitives but not yet a consistently optimized context package.

## AI Provider Architecture — 6/10

Provider abstraction, OpenAI-compatible transport, streaming, tool calls, retries, normalized errors, and encrypted key storage exist.

Scores:

| Area                  | Score |
| --------------------- | ----: |
| Provider abstraction  |     7 |
| Streaming             |     6 |
| Tool calling          |     5 |
| Error handling        |     6 |
| Retry                 |     5 |
| Timeout/cancellation  |     5 |
| Model configuration   |     6 |
| API-key security      |     7 |
| Fallback architecture |     2 |
| Provider independence |     5 |

Experimental Labs is not a validated provider implementation; the configured OpenAI-compatible path is the real provider path.

## Model Failure Handling — 5/10

Authentication/rate-limit/provider error normalization exists. Malformed streaming chunks are skipped rather than always surfaced. Invalid tool-call behavior, incomplete streams, retry duplication, and provider-driven repair scenarios are not comprehensively tested.

## Terminal — 5/10

Structured test commands, shell mode, output streaming, limits, timeouts, exit codes, working directories, environment filtering, and Unix process groups exist.

Weaknesses:

- Arbitrary shell remains a broad authority
- Windows process-tree cancellation is not validated
- Direct human terminal path is separate and less controlled
- Environment filtering is heuristic
- Large output and descendant-process behavior lack full adversarial coverage

## Testing Engine — 6/10

Project detection, related-test ranking, targeted command construction, direct executable execution, streaming, persistence, and agent tool integration exist.

Gaps:

- Framework-specific pass/fail parsing
- Test timeout/crash matrix
- Automatic targeted → module → full escalation
- Rich failure extraction
- Full UI testing panel

## Test-Driven Agent Loop — 5/10

The deterministic golden integration proves a real change → test failure → repair → retest path. In general runtime usage, automatic post-approval testing and model-driven diagnosis remain dependent on the provider requesting the correct tools. It is integrated enough for a controlled scenario, not mature enough for broad autonomous trust.

## Git — 5/10

Baseline branch/HEAD/status/diff capture and path-level agent/pre-existing/overlap attribution exist.

Gaps include staged-vs-unstaged attribution, renames, merge conflicts, detached HEAD, no-Git workspaces, untracked-file semantics, and complete final Git UI.

## Session Management — 5/10

Creation, persistence, history, interrupted detection, review, resume-only restoration, discard, changes, tests, repairs, summaries, and checkpoints exist.

Exact resume is intentionally absent. This is safer than replaying destructive operations, but it limits the product’s long-running-agent value.

## Review / Debug / Refactor Modes

| Mode     | Score | Assessment                                                           |
| -------- | ----: | -------------------------------------------------------------------- |
| Review   |     2 | No serious independent review workflow with structured findings      |
| Debug    |     3 | Diagnostic/repair states exist, but no dedicated evidence-first mode |
| Refactor |     2 | No dedicated behavior-preserving refactor orchestration              |

## UI/UX — 4/10

| Surface                | Score | Assessment                                                    |
| ---------------------- | ----: | ------------------------------------------------------------- |
| Overall UX             |     4 | Compact shell, functional but immature                        |
| Editor                 |     4 | Textarea editor, not Monaco-class                             |
| Explorer/tabs          |     5 | Basic working explorer and tabs                               |
| Terminal               |     4 | Output UI exists, not full terminal experience                |
| Agent panel            |     5 | Prompt, activity, sessions, persisted evidence                |
| Plan UI                |     2 | No full plan approval/edit experience                         |
| Diff UI                |     4 | Persisted unified diff review, limited navigation/inline view |
| Timeline               |     4 | Activity log, limited event detail/navigation                 |
| Testing panel          |     4 | Basic persisted test panel                                    |
| Problems panel         |     1 | Not implemented as a real panel                               |
| Git panel              |     1 | Read-only Git tools, no professional panel                    |
| Search                 |     3 | Backend primitives, limited user-facing experience            |
| Sessions               |     5 | Recent/interrupted session controls                           |
| Settings               |     4 | Provider settings only, not full product settings             |
| Errors/loading         |     3 | Raw/compact error UX and limited error boundaries             |
| Keyboard/accessibility |     3 | Some shortcuts, limited accessibility audit                   |

## Agent Timeline — 5/10

Real events, command chunks, persisted changes, test runs, repair history, and summaries exist. Timeline details are not fully clickable, filterable, or diagnostically rich. It is useful evidence UI, not yet the defining professional timeline described in the product vision.

## Developer Control — 7/10

Approval, rejection, stop/cancel, diff review, command visibility, session discard, and change ownership foundations are strong. Control is reduced by incomplete batch-recovery UX, limited command policy configuration, and lack of full plan/edit/review surfaces.

## Observability — 5/10

Session/event/tool/change/test/repair identifiers exist. Engineers can reconstruct many in-process workflows. Diagnostic export, uniform correlation across all records, technical-detail separation, and crash-time completeness are incomplete.

## Performance

### Performance — 4/10, LOW confidence

No actual measurements exist for startup, 1k/10k/50k files, large diffs, memory, CPU, renderer responsiveness, or long event streams. Indexing and SQLite calls run in the main process. Large repository and large file readiness are therefore **UNVALIDATED**.

### Large repository readiness

| Size       | Score | Evidence                                         |
| ---------- | ----: | ------------------------------------------------ |
| 1k files   |     4 | Sequential scanner likely workable; not measured |
| 10k files  |     3 | No measurement; main-process scan risk           |
| 50k+ files |     2 | No watcher/worker architecture or evidence       |

### Large file readiness

Large-read limits exist for some reads, but editor/diff/index/context behavior at 10 MB, 50 MB, and 100 MB is unvalidated. Score: `3/10`.

## Reliability — 5/10

| Area               | Score |
| ------------------ | ----: |
| Startup            |     2 |
| Workspace loading  |     4 |
| Agent execution    |     5 |
| Tool execution     |     5 |
| Change application |     6 |
| Testing            |     5 |
| Persistence        |     5 |
| Recovery           |     4 |
| Cancellation       |     6 |
| Concurrency        |     5 |
| Provider failure   |     5 |
| Filesystem failure |     4 |
| Database failure   |     3 |

## Data-loss Safety — 6/10

**Strengths:** Hash conflict protection, symlink checks, preflight, batch journal, rollback attempt, safe revert, compare-and-set actions.

**Weaknesses:** No complete crash injection suite; rollback can be partial; direct human file-write path is separate; exact restart continuation is absent; database/filesystem atomicity is not guaranteed.

## Prompt Injection Resistance — 3/10

Repository instructions, README content, source comments, test output, terminal output, and Git text are all potentially model-visible. Main-process authorization prevents direct privilege escalation, but there is no strong typed distinction between trusted instructions and untrusted repository/tool content. This is below production standard for an autonomous coding agent.

## Supply Chain Security — 3/10

`npm audit` reports three high findings and major-version fixes. Electron cannot run. Dependency changes by the agent require permission in the agent command path, but supply-chain policy and lockfile review are not mature.

## Privacy — 5/10

API keys are kept in main-process secure storage and are not intentionally exposed to the renderer. Source content, diffs, command output, test output, prompts, and summaries persist in SQLite. Retention, redaction, provider-transmission disclosure, and diagnostic export privacy are incomplete.

## Documentation — 7/10

Architecture, security, approval-flow, current-state, final-architecture, production-audit, remediation, release-checklist, and product-status documents exist. Documentation is unusually strong for the project, but some documents necessarily describe incomplete behavior and require continued synchronization.

## Test Maturity — 6/10

**Evidence:** 26 passing tests across provider, runtime, changes, batch, security, indexing, context, commands, testing, Git attribution, and golden workflow.

**Gaps:** No real Electron, crash injection, full IPC handler matrix, large-repository stress, Windows process-tree, database corruption, migration upgrade/rollback, or prompt-injection integration tests.

## E2E Maturity

| Level                    | Score | Status                                                  |
| ------------------------ | ----: | ------------------------------------------------------- |
| Unit workflow            |     7 | Strong deterministic coverage                           |
| Integration workflow     |     6 | Golden workflow passes with real filesystem/test runner |
| Electron workflow        |     2 | BLOCKED; binary unavailable                             |
| Production-like workflow |     2 | No real desktop/provider/dependency validation          |

## Competitive Assessment

This is conceptual, not benchmarked against private implementations.

| Category                | Position                | Reason                                                                                                |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Traditional IDE editor  | Behind                  | Current editor is a compact textarea shell, not VS Code/JetBrains-class                               |
| VS Code-class IDE       | Behind                  | Missing language services, panels, mature navigation, and extension ecosystem                         |
| AI-assisted editor      | Behind to comparable    | Durable approval is stronger than many chat integrations; UX and provider validation lag              |
| Agentic AI IDE          | Comparable conceptually | Change safety, evidence, sessions, and repair foundations are meaningful                              |
| Autonomous coding agent | Behind                  | Real Electron validation, exact resume, broad provider repair, and production recovery are incomplete |
| Safety/control          | Strong conceptually     | Persisted proposals, hash protection, authorization, and evidence are differentiators                 |

## Product Differentiators

### Durable agent changes

**Maturity:** 6/10. Persisted proposals, diffs, approval, hashes, conflicts, and batch journal exist.

### Evidence-driven completion

**Maturity:** 5/10. Test runs, repair attempts, summaries, and golden workflow evidence exist.

### Free-tier efficiency

**Maturity:** 5/10. Local indexing, ranking, hashing, budgets, and targeted testing exist.

### Developer-controlled autonomy

**Maturity:** 7/10. Approval and cancellation boundaries are stronger than the rest of product maturity.

## Top 10 Weaknesses

1. Electron cannot launch, so the actual product is unvalidated.
2. Shell execution remains a broad authority boundary.
3. Batch crash recovery is not proven by crash injection.
4. Exact agent resume is unavailable.
5. Provider-driven repair is less mature than the deterministic workflow.
6. Prompt-injection trust boundaries are not strongly encoded.
7. SQLite migration/recovery/retention are immature.
8. UI lacks professional plan, Git, Problems, diff-navigation, and testing surfaces.
9. Repository symbols/search lack semantic references and file watching.
10. Dependency vulnerabilities include three high findings.

## Top 10 Strengths

1. ChangeService is an explicit authority rather than direct agent file mutation.
2. Approval is durable and asynchronous.
3. Hash-based conflict protection preserves external changes.
4. Multi-file batch preflight and journaling are now present.
5. Golden workflow exercises real filesystem and test execution.
6. Agent/test/repair evidence is persisted.
7. Session/workspace authorization is implemented and tested.
8. Symlink and secret-file indexing protections are covered.
9. Testing/project detection is deterministic and local.
10. The project has unusually candid audit and remediation documentation.

## Top Release Blockers

| Priority | Blocker                                 | Impact                                     | Required validation                                           |
| -------- | --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| P1       | Electron binary/E2E blocked             | Cannot validate actual product             | Launch and full renderer/main E2E                             |
| P1       | Dependency vulnerabilities              | Runtime/security exposure                  | Deliberate Electron/Vite upgrade and E2E                      |
| P1       | Batch crash recovery unproven           | Possible ambiguous filesystem state        | Crash injection at every replacement boundary                 |
| P1       | Shell execution authority               | Command injection/process-tree risk        | Structured default, shell policy, process-tree tests          |
| P1       | Exact resume unavailable                | Long-running tasks cannot continue safely  | Deterministic checkpoint replay or explicit product scope     |
| P1       | IPC matrix incomplete                   | Unvalidated privileged boundary            | Route-level malformed/replay/concurrency suite                |
| P1       | Provider repair incomplete              | Golden scenario may overstate autonomy     | Invalid-tool/dangerous-command/environment/provider scenarios |
| P2       | Prompt-injection trust boundary weak    | Repository text can steer model reasoning  | Typed untrusted context and injection tests                   |
| P2       | UI/product tooling immature             | Developer friction and low discoverability | Plan/Git/Problems/testing/diff panels                         |
| P2       | Large repo/file performance unvalidated | Unknown responsiveness/scalability         | 1k/10k/50k and large-file measurements                        |

## Technical Debt — 5/10

Debt is moderate/high. Evidence includes dense Electron runtime orchestration, duplicate validation, ad hoc migrations, regex symbol extraction, separate human/agent write paths, incomplete test/E2E layers, and documentation describing intentionally incomplete behavior.

## Maintainability — 5/10

TypeScript and package boundaries help. Tests are readable and focused. However, callback-heavy runtime construction, broad repositories, duplicated SQL projections, and mixed responsibilities make changes risky as the product grows.

## Scalability — 4/10

No measurements exist for large repositories, long sessions, many events, large diffs, many sessions, or concurrent operations. Main-process sequential scanning and synchronous SQLite calls are likely bottlenecks.

## Extensibility — 6/10

Provider, tool, testing detector, indexing, and context abstractions are usable. New agent states, durable entities, and UI modes require changes across runtime, database, IPC, preload types, and renderer.

## Developer Trust — 5/10

Approval, diffs, hashes, conflicts, evidence, and no-fake-success intent are strong. Trust is reduced by blocked Electron validation, incomplete recovery, shell authority, prompt-injection weakness, and immature UI/error reporting.

## Would I Trust It?

### Small toy repository

**YES, with supervision.** The deterministic workflow, approval, hashes, and tests are useful. Keep backups and review every change.

### Personal project

**CONDITIONALLY.** Use version control and do not allow unattended shell/dependency operations. Electron validation is still missing.

### Large production repository

**NO.** Repository scalability, semantic indexing, crash recovery, dependency posture, and desktop E2E are not sufficient.

### Valuable uncommitted changes

**NO for unattended use.** Hash/conflict protection is good, but batch crash recovery and direct editor write paths are not fully production-proven.

### Long-running autonomous task

**NO.** Exact resume is unavailable and provider-driven repair/orchestration is incomplete.

### Dependency installation task

**NO without direct supervision.** Network/supply-chain risks and shell/dependency policy need stronger controls.

### Destructive command task

**NO.** Use a separate manually supervised terminal. The agent shell boundary is too broad for unattended destructive operations.

## Roadmap to 9/10

### Current: 5.1/10

### To reach 7

- Fix Electron installation and pass real launch/renderer/main E2E
- Complete batch crash injection and recovery verification
- Finish malformed/replay IPC matrix
- Establish structured command default and shell policy
- Add test timeouts and provider repair scenarios

### To reach 8

- Implement deterministic checkpoint replay for safe resume
- Complete dependency upgrades and audit remediation
- Add prompt-injection/untrusted-context boundaries
- Add semantic references/file watching
- Add professional plan/diff/Git/testing/Problems UX
- Measure large repository and large file performance

### To reach 9

- Demonstrate production-like desktop workflow across failure/restart/concurrency matrices
- Mature provider-independent repair and failure classification
- Provide robust database/filesystem recovery with audited retention/privacy
- Reach strong IDE navigation and diagnostics quality
- Validate packaging and supported platform matrix

### To reach 10

Exceptional cross-platform reliability, semantic repository intelligence, best-in-class agent recovery, mature UX, comprehensive privacy/supply-chain controls, and long-term operational evidence would be required.

## 30/60/90-Day Priorities

### Next 30 days

- Fix Electron installation in CI/development environments
- Run real Electron launch and approval E2E
- Add crash-injection batch tests
- Complete IPC malformed/replay/concurrency matrix
- Establish structured command/shell policy and process-tree tests
- Resolve high dependency findings or document approved risk

### Next 60 days

- Implement safe deterministic checkpoint replay
- Complete provider-driven repair scenario matrix
- Add prompt-injection and secret-aware context tests
- Add file watcher and move indexing off the main process
- Build real plan, testing, Git, Problems, and diff review surfaces

### Next 90 days

- Improve semantic symbol/reference intelligence
- Add full review/debug/refactor modes
- Measure and optimize large repositories and long sessions
- Validate packaging, retention, diagnostics, and supported OS behavior

## Interpretation

```text
0–3  Prototype
4–5  Early usable
6    Usable but immature
7    Good
8    Strong
9    Excellent
10   Exceptional
```

G1Code is currently an **Early Product**: technically credible and useful for supervised experimentation, but not a production-ready IDE.

## Final Verdict

```text
EARLY PRODUCT
```

```text
Electron validation: BLOCKED
Security: NEEDS WORK
Data-loss safety: NEEDS WORK
Agent reliability: NEEDS WORK
E2E: BLOCKED
```

## Principal Engineer Release Decision

**NO**, I would not approve release tomorrow.

Top five reasons:

1. Real Electron launch and renderer/main IPC behavior have not been validated.
2. Crash recovery for multi-file replacement is not adversarially proven.
3. Shell execution and environment isolation remain too broad for unattended agent authority.
4. Exact agent resume and provider-driven repair are incomplete.
5. Dependency audit still reports three high findings.
