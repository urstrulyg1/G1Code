# ADR-0001 — Independent platform, not a VS Code fork

**Status:** Accepted  
**Date:** 2026-09-07

## Context

Cursor, Windsurf, Google Antigravity, and several other AI IDEs are VS Code forks. Forking Code-OSS inherits Monaco, the workbench, LSP/DAP, the extension host, and (partially) the extension ecosystem overnight.

It also inherits:

- Microsoft product gravity (marketplace ToS, closed-source remote/Copilot pieces)
- Extension APIs designed to *prevent* deep UI and agent integration (no direct DOM, constrained workbench mutation)
- A “chat bolted onto an editor” shape that is expensive to invert
- Supply-chain risk when forks point at Open VSX while still recommending Microsoft extension IDs
- Legal inability to use the Visual Studio Marketplace (`Marketplace Offerings` may only be used with Visual Studio Products and Services)

Eclipse Theia is *not* a fork and is the closest open platform, but it is a generic tool framework, not an AI-native workbench. Adopting Theia would still mean fighting its extension/workbench model to make agents, context, and permissions first-class.

## Decision

G1Code is an **independent IDE platform**.

We reuse **open protocols and components**, not the VS Code product:

- Monaco (editor)
- LSP, DAP
- xterm.js + node-pty (terminal)
- Tree-sitter
- MCP and ACP
- Open VSX as *one* extension source, behind a compatibility layer

We do **not** fork `microsoft/vscode`.

## Alternatives

1. **Fork Code-OSS** (Cursor model) — fastest to a familiar UI; poorest strategic position.
2. **Adopt Eclipse Theia** — modular, desktop+cloud, VS Code extension compat; not AI-native; governance/weight of a generic platform.
3. **Native GPU editor (Zed/GPUI model)** — best latency; multi-year UI rebuild; kills MVP timeline.
4. **Independent platform** (chosen).

## Reason

The product requirement is explicit: G1Code must not be “a code editor with an AI chat panel.” Forking VS Code makes that failure mode the default. An independent core lets AI, agents, context, permissions, and patches live at the same layer as the editor—not behind extension APIs Microsoft designed to sandbox them.

## Consequences

- **Cost:** We rebuild workbench, explorer, SCM, settings, command palette, layout.
- **Benefit:** Clean legal story, native agent APIs, no marketplace ToS trap, no Microsoft-only features we cannot ship.
- **Compatibility:** VS Code extensions are a *layer*, not the runtime. Compatibility will be Full / Partial / Unsupported / Requires Adapter — never assumed 100%.
- **Migration:** Users import settings, keybindings, snippets, and (where legal) extensions. We do not pretend to be VS Code.
