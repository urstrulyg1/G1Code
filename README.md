# G1Code AI IDE

G1Code is an AI-first desktop development environment. The repository currently contains the Phase 0 architecture and the first Phase 1 shell: a secure Electron main/preload boundary with a React + TypeScript renderer.

## Development

Requirements: Node.js 20+ and npm 10+.

```bash
npm install
npm run dev
npm run build
```

The shell works without an AI provider. Phase 2 adds a configurable OpenAI-compatible provider, encrypted credentials, persisted agent sessions, workspace tools, managed cancellation, and guarded file changes. See `docs/development/phase-2-hardening.md` for the audit and remaining hardening work.

## Project layout

- `apps/desktop`: Electron process, preload bridge, and React UI
- `docs/architecture`: architecture decisions and phase roadmap
- `packages`: reserved for shared agent, AI, indexing, and tool packages
- `.g1code`: project-level metadata templates

## Security baseline

Renderer code has no direct Node.js access. Filesystem and command operations cross a narrow, validated preload API. Terminal commands are explicit user actions in Phase 1; agent permission policy will be added before agent-controlled execution.
