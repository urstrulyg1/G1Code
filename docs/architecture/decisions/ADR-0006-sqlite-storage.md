# ADR-0006 — SQLite + FTS5 + sqlite-vec

**Status:** Accepted  
**Date:** 2026-09-07

## Context

The IDE needs local, durable storage for workspace metadata, conversations, tasks, agent traces, permissions, diagnostics cache, and embeddings — including **offline** and **air-gapped** modes. Secrets must never live in plaintext next to this data.

## Decision

One **embedded SQLite** database per workspace (plus a user-global DB), WAL mode.

- Relational data: SQLite
- Lexical search: **FTS5**
- Vectors: **sqlite-vec** behind `VectorStore`
- Secrets: OS keychain / credential vault, never SQLite plaintext

`VectorStore` is an interface. sqlite-vec is the default implementation, not a hard-coded dependency of the context engine.

## Alternatives

| Option | Pros | Cons |
| ------ | ---- | ---- |
| SQLite family (chosen) | Zero ops, one file, offline, proven in IDEs | Writer concurrency limits (WAL is enough for a workstation) |
| DuckDB | Analytics | Wrong fit for OLTP + FTS |
| Separate vector DB (Qdrant, etc.) | Scale | Ops, network, overkill on a laptop |
| IndexedDB only | Easy in renderer | Not for agents/services; quota; no FTS quality |

## Reason

Cursor-style “index the repo into the cloud” fights privacy mode. A local SQLite file *is* the index. Hybrid BM25 + vector + RRF is a known good retrieval design and fits one process.

## Consequences

- Schema migrations are versioned and tested.
- `.g1code/index/` is gitignored.
- Remote workspaces: the DB lives **next to the code** (remote), UI streams queries.
- If sqlite-vec is awkward on some arch, swap the `VectorStore` impl without touching retrieval policy.
