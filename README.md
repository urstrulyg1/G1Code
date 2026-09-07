# G1Code

**Code with an AI that understands your entire project.**

G1Code is a next-generation AI-native IDE — editor, terminal, Git, debugger, language intelligence, extensions, MCP, project understanding, and autonomous agents as one system. It is not a chat panel glued to a code editor, and it is not a VS Code fork.

## Status

**Phase 0 — Architecture.** Implementation has not started. The first deliverable is the outline for review.

- [Complete architecture & implementation outline](docs/architecture/G1CODE-ARCHITECTURE-OUTLINE.md)
- [Architecture decision records](docs/architecture/decisions/)

## Principles

- AI is a first-class subsystem with project-wide context
- Agents plan, edit, build, test, diagnose, and review — they do not stop at generation
- Every AI write is a patch with checkpoints
- Models, embeddings, and clouds are adapters (Arena AI is first-class, never exclusive)
- Permissions, secrets, and prompt-injection boundaries are product features

## Platforms (target)

macOS · Windows · Linux (Apple Silicon, x64, ARM64)

## License

Apache License 2.0 is [proposed](docs/architecture/decisions/ADR-0014-license.md) pending confirmation.
