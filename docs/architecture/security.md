# Security Architecture

All paths received by capability handlers are normalized and must be within the selected workspace for workspace operations. Destructive file and Git operations require explicit confirmation. Commands are classified before execution; package installation, network-sensitive commands, privilege escalation, destructive flags, and credential access are denied or confirmation-gated.

Every agent tool call records the tool, sanitized inputs, permission decision, duration, exit/result status, and request/session IDs. Output is bounded. Secrets are redacted before logging. Agent execution is cancellable and budgeted.

The Phase 1 terminal is human-triggered. Agent execution must not be enabled by reusing this handler without adding policy evaluation and audit records.

Agent edit tools use workspace-root and real-path containment checks, then pass through the `ChangeService` approval boundary. Proposal is non-mutating: it stores original/proposed content, hashes, and a unified diff as `PENDING`. Only the main process can load a persisted change and apply it after validating session, workspace, status, and original hash. Renderer approval payloads contain only a change ID and action; renderer-supplied content, path, or hash is never trusted. Conflicts leave the current file untouched.

API keys are encrypted with Electron `safeStorage` in the main process. The renderer receives configuration metadata only. The existing Phase 1 human terminal remains a separate legacy handler and should not be treated as the agent security boundary.
