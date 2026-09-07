# ADR-0010 — pnpm workspaces + Turborepo

**Status:** Accepted  
**Date:** 2026-09-07

## Context

The recommended shape is a monorepo: apps (desktop, web, cli), many packages, Go services, extensions, docs, tests.

## Decision

- **pnpm** workspaces for JS/TS
- **Turborepo** for task graph, caching, affected builds
- Go modules under `services/` with a Makefile/`just` entry, orchestrated from turbo via `turbo.json` pipeline hooks
- Root `tsconfig` project references; strict mode everywhere

## Alternatives

Nx (heavier, more magic), Bazel (correct at Google scale, wrong for this team now), multiple repos (API drift).

## Reason

pnpm + turbo is the default competent TS monorepo in 2026. It matches the brief. We do not need Bazel until we have the problems Bazel solves.

## Consequences

- Package names: `@g1code/*`
- No circular deps; `core` does not import `ui`.
- CI cache is a feature, not a nice-to-have.
