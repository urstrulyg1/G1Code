# ADR-0004 — React workbench UI

**Status:** Accepted  
**Date:** 2026-09-07

## Context

The workbench (activity bar, sidebars, panels, AI surfaces, settings) must be productive to build, accessible, and themeable. Monaco integrates with several UI libraries.

## Decision

**React 19** + TypeScript for all workbench UI.

State: explicit stores (workspace, editors, agents, scm) over a typed event bus — not a single global Redux blob.

Lists (explorer, search, SCM, problems): **virtualized**.

## Alternatives

| Option | Pros | Cons |
| ------ | ---- | ---- |
| React | Talent, ecosystem, Monaco bindings, a11y | Runtime cost if misused |
| Solid | Fine-grained perf | Smaller ecosystem, hiring |
| Svelte | Ergonomics | Same |
| Custom DOM | Fast | Unmaintainable |

## Reason

The workbench is an application, not a 120 fps game. Virtualization and process isolation dominate perceived speed. React maximizes delivery of the actual differentiators (AI panel, composer, agent timeline, review).

## Consequences

- Strict rules: no heavy work in render; no indexing on the UI thread (ADR-0012).
- Design system in `@g1code/ui` with tokens for dark / light / high-contrast.
- Theia/VS Code CSS is **not** copied; we design G1Code.
