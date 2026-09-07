# Agent Architecture

The orchestrator is modeled as a bounded state machine:

`IDLE -> UNDERSTANDING -> ANALYZING -> PLANNING -> WAITING_FOR_APPROVAL -> EXECUTING -> OBSERVING -> TESTING -> VERIFYING -> REVIEWING -> COMPLETED`

Failures transition through `FAILED -> DIAGNOSING -> REPLANNING`, subject to `maxIterations`, `maxToolCalls`, and `maxExecutionTime`. Each transition emits an immutable activity event with task ID, state, timestamp, and optional tool execution ID.

Specialized planner, coder, debugger, tester, and reviewer roles are interfaces behind one orchestrator. The orchestrator, not the model, owns permissions, budgets, retries, cancellation, and terminal conditions.

Phase 2 implements the bounded runtime in `packages/agent/runtime.ts`. It consumes the provider abstraction, a workspace-scoped tool registry, and an approval callback supplied by Electron IPC. Tool results are appended to the provider conversation and streamed events are emitted only after provider or tool activity occurs.

Modes are policy configurations: Ask disallows mutating tools, Plan pauses after a proposed plan, Agent permits approved tools, and Review restricts the tool set to inspection.
