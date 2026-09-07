# ADR-0007 — Tree-sitter + LSP as dual language layers

**Status:** Accepted  
**Date:** 2026-09-07

## Context

Language intelligence has two jobs that VS Code often conflates:

1. **Fast, local, incremental structure** — highlighting, folds, symbols, AST queries for the context engine.
2. **Correct, language-true intelligence** — types, defs, refs, rename, diagnostics, code actions.

LSP is the industry standard for (2). Tree-sitter is the industry standard for (1). Relying on LSP alone makes the context engine wait on slow servers. Relying on Tree-sitter alone cannot rename a Java method safely.

## Decision

- **Tree-sitter** (native or WASM, decided per platform in implementation) for parse, highlight, outline, AST search, and indexer symbol extraction.
- **LSP** as the primary language-intelligence integration. G1Code is an LSP *client*, not a new language server for Tier 1 languages.
- **DAP** for debugging (separate ADR-adjacent: see outline §P).

Adding a language must not require editing the editor core — register a grammar + an LSP adapter.

## Alternatives

- LSP only — weak offline/partial-file context, slow indexer.
- Custom compilers in-process — Eclipse JDT model; unbeatable for Java, unmaintainable for 15 languages.
- Tree-sitter only — incorrect types, no real rename.

## Reason

This is how modern editors (Zed, Helix, Neovim) and VS Code (TextMate + LSP; Zed-style Tree-sitter is the better parse layer) should have been designed. G1Code’s context engine *depends* on an always-available AST.

## Consequences

- Indexer uses Tree-sitter first, LSP symbols as enrichment when the server is ready.
- Semantic highlighting prefers LSP semantic tokens, falls back to Tree-sitter.
- Java depth (Eclipse-class refactor) is a **language extension** that may embed JDT LS, not a core special case.
