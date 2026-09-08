# Release Checklist

- [ ] Clean checkout
- [ ] `npm install`
- [ ] Production build
- [ ] Unit and integration tests
- [ ] Security tests
- [ ] Electron launch (BLOCKED: missing Electron binary in environment)
- [ ] `npm run e2e:smoke` (must be PASS before release)
- [x] Golden fixture workflow
- [x] Repair workflow (deterministic integration)
- [ ] Restart workflow
- [x] Git attribution
- [ ] Dependency audit reviewed
- [ ] No secrets or debug logs
- [ ] Documentation updated
- [ ] Packaging smoke test
