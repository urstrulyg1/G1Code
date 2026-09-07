# ADR-0015 — Open VSX + G1 Marketplace, never Microsoft Marketplace

**Status:** Accepted  
**Date:** 2026-09-07

## Context

Visual Studio Marketplace terms restrict use to Visual Studio products. Forks that proxy Microsoft’s marketplace take legal and supply-chain risk. Open VSX has had namespace-squatting incidents when forks recommended Microsoft extension IDs that did not exist on Open VSX.

## Decision

- **G1 Marketplace** is the primary store (native G1 extensions, agents, themes, MCP packs).
- **Open VSX** is an optional source for *compatible* VS Code extensions, with **publisher verification** and no inherited Microsoft recommendation lists.
- We never ship a default URL to `marketplace.visualstudio.com`.
- Missing-extension recommendations never point at unclaimed Open VSX namespaces.

## Alternatives

Proxy Microsoft (Cursor-style) — legally dirty. No third-party extensions — empty. Only Open VSX — we still need G1-native permissions metadata Open VSX does not have.

## Reason

Legal cleanliness is a differentiator. The 2026 Open VSX recommendation-squatting attacks are a warning: do not inherit another product’s extension IDs.

## Consequences

- Popular Microsoft-branded extensions (`ms-python`, `ms-vscode.cpptools`) may be **Unsupported** or replaced by G1/Open-source adapters.
- Marketplace entries must declare permissions (fs, net, terminal, AI, MCP).
- Private enterprise registries are a first-class Phase 8 feature, designed in now.
