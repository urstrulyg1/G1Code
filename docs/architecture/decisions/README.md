# Architecture Decision Records

This directory records **major, durable** decisions for G1Code.

Format (every ADR):

- **Context** — the problem and constraints
- **Decision** — what we chose
- **Alternatives** — what we considered
- **Reason** — why this option won
- **Consequences** — costs, follow-ups, reversibility

## Index

| ID | Title | Status |
| -- | ----- | ------ |
| [ADR-0001](./ADR-0001-independent-platform-not-a-vscode-fork.md) | Independent platform, not a VS Code fork | Accepted |
| [ADR-0002](./ADR-0002-electron-desktop-shell.md) | Electron desktop shell with a shell abstraction | Accepted |
| [ADR-0003](./ADR-0003-monaco-editor.md) | Monaco as the editing surface | Accepted |
| [ADR-0004](./ADR-0004-react-workbench.md) | React workbench UI | Accepted |
| [ADR-0005](./ADR-0005-typescript-core-go-services.md) | TypeScript application core, Go for heavy services | Accepted |
| [ADR-0006](./ADR-0006-sqlite-storage.md) | SQLite + FTS5 + sqlite-vec | Accepted |
| [ADR-0007](./ADR-0007-treesitter-and-lsp.md) | Tree-sitter + LSP as dual language layers | Accepted |
| [ADR-0008](./ADR-0008-provider-agnostic-ai.md) | Provider-agnostic AI (Arena AI first-class, not exclusive) | Accepted |
| [ADR-0009](./ADR-0009-dual-extension-model.md) | Native G1 APIs + VS Code compatibility layer | Accepted |
| [ADR-0010](./ADR-0010-pnpm-turborepo.md) | pnpm workspaces + Turborepo | Accepted |
| [ADR-0011](./ADR-0011-mcp-and-acp.md) | MCP for tools, ACP for external agents | Accepted |
| [ADR-0012](./ADR-0012-multi-process-isolation.md) | Multi-process isolation | Accepted |
| [ADR-0013](./ADR-0013-patch-engine-and-checkpoints.md) | Patch engine + checkpoints for all AI writes | Accepted |
| [ADR-0014](./ADR-0014-license.md) | Apache License 2.0 | Proposed |
| [ADR-0015](./ADR-0015-open-vsx-marketplace.md) | Open VSX + G1 Marketplace, never Microsoft Marketplace | Accepted |

## Change rule

If a later phase reverses a major decision (shell, database, language, AI provider, extension model, agent model), do **not** silently change it. Write a superseding ADR with:

```text
Original decision
New decision
Reason
Advantages
Disadvantages
Migration impact
```
