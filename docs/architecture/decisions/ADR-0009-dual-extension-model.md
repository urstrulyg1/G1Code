# ADR-0009 — Dual extension model (native G1 APIs + VS Code compatibility)

**Status:** Accepted  
**Date:** 2026-09-07

## Context

VS Code won on extensions. It also intentionally restricts extensions (no DOM, extension host isolation, slow API evolution). Serious language tools (Java, C++, Docker) still live there. Ignoring them loses the market; becoming them loses the product.

## Decision

Two layers:

1. **G1 Extension API** (native) — versioned, permissioned, documented, with UI, Editor, Terminal, Git, AI, Agent, Context, Workspace, Debugger, Language, MCP, Settings APIs. Extensions *may* contribute controlled UI (not arbitrary DOM).
2. **G1Code Extension Compatibility Layer** — implements a subset of `vscode.d.ts` on top of G1 APIs. Each extension is classified Full / Partial / Unsupported / Requires Adapter.

The extension host is a **separate process** (ADR-0012). Native G1 extensions and compatible VS Code extensions both run there, with different API surfaces.

Marketplace: G1 Marketplace + Open VSX (ADR-0015). Never the Microsoft Marketplace.

## Alternatives

- VS Code API only — we become a worse fork.
- Native only — empty ecosystem on day one.
- Load arbitrary VS Code extensions in the renderer — security disaster.

## Reason

Native APIs are how we avoid VS Code’s extension limitations. Compatibility is how users migrate. Honesty about compatibility is how we avoid Cursor-style surprise breakage.

## Consequences

- Compatibility is a product with tests, not a slogan.
- Language packs for Tier 1 may be **native G1 extensions** wrapping LSP, not a hope that `ms-python` loads.
- UI extensions get a sandbox (webview with CSP, or declared contribution points).
