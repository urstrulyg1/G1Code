# ADR-0003 — Monaco as the editing surface

**Status:** Accepted  
**Date:** 2026-09-07

## Context

The editor is the highest-frequency surface in the product. Requirements include multi-cursor, folding, minimap, sticky scroll, semantic tokens, inline diffs, merge editor, large-file mode, and inline AI edits.

## Decision

Use **Monaco** as the editing surface, wrapped by `@g1code/editor` so the workbench never talks to Monaco APIs ad hoc.

Inline AI (ghost text, Cmd/Ctrl+K, inline diff) is a G1Code layer *on top of* Monaco, not a Monaco fork.

## Alternatives

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Monaco | VS Code editing parity, diff/merge, workers, large-file virtualization | Heavy (~5–10 MB), Chromium-oriented |
| CodeMirror 6 | Modular, small, excellent web | Not an IDE editor (diff/merge/minimap/semantic tokens/AI inline are rebuilds) |
| Custom | Ultimate control | Unthinkable for MVP |

## Reason

Rebuilding an editor is how IDEs die. Monaco is the one component of VS Code that is designed to be reused. G1Code’s differentiation is **around** the buffer (context, agents, patches, review), not inside the keystroke loop.

## Consequences

- Large-file mode: disable decorations, minimap, wrapping; use Monaco’s large-file path.
- Notebooks: Monaco cells, not a second editor.
- Headless/agent edits go through the patch engine, not through Monaco. Monaco is a view.
