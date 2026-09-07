# System Architecture

G1Code is a desktop application with three trust zones:

1. The React renderer owns presentation, editor state, and user interaction.
2. The Electron preload bridge exposes a small, typed capability API. The renderer never receives Node.js or Electron access.
3. The Electron main process owns filesystem, process, Git, secure storage, and provider networking capabilities.

The first release uses Electron because it allows a production-grade Monaco experience and a direct incremental path to a local agent runtime. Domain logic should move into `packages/*` as it becomes reusable and testable. IPC handlers should remain adapters, not business logic.

## Runtime boundaries

The agent runtime will be a stateful orchestration service in the main process. It will communicate with the renderer through event streams containing real tool execution records. Provider adapters will be injected into the runtime, allowing Experimental Labs to be the initial implementation without coupling orchestration to a vendor SDK.

## Non-goals for Phase 1

There is no fake AI response, fake index, or fake terminal stream. AI, indexing, Git mutations, and agent-controlled commands are deferred until their permission and audit contracts exist.
