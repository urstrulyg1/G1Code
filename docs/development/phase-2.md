# Phase 2 Development

## Provider status

The provider layer is vendor-neutral and the first transport is OpenAI-compatible. The requested Experimental Labs public API could not be verified during implementation: `experimental-labs.com`, `api.experimental-labs.com`, and `docs.experimental-labs.com` currently resolve to parked-domain pages rather than API documentation. G1Code therefore does not ship an invented endpoint, authentication scheme, or free-tier model name.

Configure the confirmed provider endpoint and model identifier in **Settings > AI**. The main process owns the API key and stores it through Electron `safeStorage`; React receives only a boolean configuration state. When the Experimental Labs endpoint and schema are available, its adapter can be added without changing the agent runtime.

## Runtime

The agent runs in the Electron main process. It streams provider chunks to the renderer, sends tool calls to the workspace registry, requests permission for moderate and dangerous operations, and returns real tool results to the provider. Ask mode has no tools, Plan mode has read/search tools, and Agent mode has all Phase 2 tools.

Limits are 30 iterations, 100 tool calls, and 15 minutes per task. Edit and command permissions are blocking IPC requests. Path validation resolves every tool path against the selected workspace.

## Testing

```bash
npm install
npm test
npm run build
git diff --check
```

Provider tests mock `fetch` only at the transport boundary. They do not mock application activity. Workspace tests cover traversal and absolute-path escapes.

## Troubleshooting

- `Configure an API key first`: save a key in Settings. It is not persisted in renderer state.
- `Select a model before starting an AI task`: enter a model identifier or refresh models after configuring a compatible endpoint.
- `Model discovery failed`: the configured endpoint does not expose an OpenAI-compatible `/models` route; enter the model identifier manually.
- `Provider request failed (401/403/429)`: verify credentials, access, and provider quota. 429 and 5xx responses retry three times with backoff.
