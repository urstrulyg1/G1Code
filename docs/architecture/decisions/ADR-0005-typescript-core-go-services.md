# ADR-0005 — TypeScript application core, Go for heavy services

**Status:** Accepted  
**Date:** 2026-09-07

## Context

The stack must cover UI, application services, indexing, embeddings, agent runtimes, and later remote daemons. One language is simpler; two languages are faster where it matters.

## Decision

- **TypeScript** for: desktop app, workbench, application core, editor host, Git porcelain, MCP client, extension host API, tests that touch the UI.
- **Go** for long-lived, CPU/IO-heavy services: indexing-service, embedding workers, agent-service (tool loop + task graph persistence), update-service where native is useful.
- Services speak **JSON-RPC / stdio or named pipes**, same as LSP. The core never imports Go.

MVP may run the Go services as in-process TypeScript *adapters with the same interfaces* if that unblocks Phase 1, but the interfaces are frozen in Phase 0.

## Alternatives

| Option | Pros | Cons |
| ------ | ---- | ---- |
| All TypeScript | One toolchain | Indexing/embeddings hit V8 limits on huge monorepos |
| All Rust | Max perf | Slowest product velocity; UI still JS |
| TypeScript + Rust | Excellent native | Higher bar than Go for service code |
| TypeScript + Go (chosen) | Fast services, easy daemons, matches Tier-1 Go users | Two languages to hire for |

## Reason

G1Code’s hard problems are **orchestration and product**, not filling a ring buffer. Go gives native concurrency, small static binaries for remote agents, and a language already in Tier 1. Rust is available later for hot parsers if Tree-sitter is not enough.

## Consequences

- `packages/*` are TypeScript.
- `services/*` are Go modules with a shared protobuf/JSON-RPC contract in `packages/protocol`.
- CI must build both. No “the Go service will exist someday” without an interface and a TS fallback.
