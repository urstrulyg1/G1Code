# ADR-0014 — Apache License 2.0

**Status:** Proposed (needs product/legal review)  
**Date:** 2026-09-07

## Context

G1Code is intended as a serious platform with an ecosystem. License affects extension authors, enterprise adoption, and whether cloud providers can wrap the IDE.

## Decision (proposed)

**Apache License 2.0** for the core, packages, and default extensions.

Enterprise features (SSO adapters, private marketplace) may later live in a separate commercial repo without relicensing Apache code.

## Alternatives

| Option | Note |
| ------ | ---- |
| MIT | Simpler; weaker patent grant |
| Apache 2.0 (proposed) | Patent grant, enterprise-familiar |
| EPL-2.0 | Theia/Eclipse; copyleft-ish for derivatives |
| BSL / SSPL | Source-available; hurts ecosystem trust |
| Proprietary | Fights extension authors |

## Reason

Apache 2.0 is the default for infrastructure (K8s, LSP-adjacent tooling) and signals “platform, not trap.” Patent grant matters for an IDE.

## Consequences

- CONTRIBUTING and DCO/CLA still TBD.
- This ADR is **Proposed** until the project owner confirms. Implementation must not include a LICENSE file that contradicts a later decision — Phase 0 documents the proposal only.
- **Do not** copy VS Code source; Monaco/xterm are used via their own licenses (MIT).
