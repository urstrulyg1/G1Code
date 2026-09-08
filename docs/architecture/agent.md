# Agent Architecture

The orchestrator is modeled as a bounded state machine:

`IDLE -> UNDERSTANDING -> ANALYZING -> PLANNING -> EXECUTING -> WAITING_FOR_CHANGE_APPROVAL -> EXECUTING -> OBSERVING -> TESTING -> VERIFYING -> REVIEWING -> COMPLETED`

Failures transition through `FAILED -> DIAGNOSING -> REPLANNING`, subject to `maxIterations`, `maxToolCalls`, and `maxExecutionTime`. Each transition emits an immutable activity event with task ID, state, timestamp, and optional tool execution ID.

Specialized planner, coder, debugger, tester, and reviewer roles are interfaces behind one orchestrator. The orchestrator, not the model, owns permissions, budgets, retries, cancellation, and terminal conditions.

The bounded runtime is implemented in `packages/agent/runtime.ts`. Edit tools never apply files. They persist a `PENDING` change through `ChangeService`, return `pending_approval`, and suspend on a change-specific promise. A validated main-process approval applies the persisted content, resolves the promise, and resumes the same provider conversation. Rejection and conflict are returned to the model as tool results. Tool results are appended to the provider conversation and streamed events are emitted only after provider or tool activity occurs.

Modes are policy configurations: Ask disallows mutating tools, Plan pauses after a proposed plan, Agent permits approved tools, and Review restricts the tool set to inspection.
