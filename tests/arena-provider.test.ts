import assert from "node:assert/strict";
import { test } from "node:test";
import { ArenaAIProvider } from "../packages/ai/arena";
import {
  AuthenticationError,
  RateLimitError,
  ProviderError,
} from "../packages/ai/errors";
import { ARENA_MODELS, globalModelCatalog } from "../packages/ai/models";
import { globalProviderRegistry } from "../packages/ai/provider-registry";

test("Arena.ai Provider: Models are present and have valid metadata", () => {
  const models = ARENA_MODELS;
  assert.ok(models.length >= 4, "At least 4 Arena models defined");

  const agent = models.find((m) => m.id === "arena-agent-v1");
  assert.ok(agent, "Arena Agent V1 is defined");
  assert.equal(agent.displayName, "Arena Agent V1");
  assert.equal(agent.supportsTools, true);
  assert.equal(agent.supportsStreaming, true);
  assert.equal(agent.provider, "arena.ai");
  assert.equal(agent.recommendedRole, "agent");
  assert.equal(agent.contextWindowFormatted, "256K");

  const coder = models.find((m) => m.id === "arena-agent-coder");
  assert.ok(coder, "Arena Agent Coder is defined");
  assert.equal(coder.supportsTools, true);
  assert.equal(coder.provider, "arena.ai");

  const chat = models.find((m) => m.id === "arena-chat-v1");
  assert.ok(chat, "Arena Chat V1 is defined");
  assert.equal(chat.supportsTools, true);

  const code = models.find((m) => m.id === "arena-code-v1");
  assert.ok(code, "Arena Code V1 is defined");
});

test("Arena.ai Provider: Model catalog filters by provider", () => {
  const arenaModels = globalModelCatalog.getModels("arena.ai");
  assert.ok(arenaModels.length >= 4, "Must return Arena models");
  assert.ok(
    arenaModels.every((m) => m.provider === "arena.ai"),
    "All models must have provider = arena.ai",
  );

  const expModels = globalModelCatalog.getModels("experiential-labs");
  assert.ok(expModels.length >= 8, "Must return Experiential Labs models");
  assert.ok(
    expModels.some((m) => m.id === "gpt-6-astra"),
    "Must include gpt-6-astra",
  );
});

test("Arena.ai Provider: Provider registry instantiates ArenaAIProvider", () => {
  const provider = globalProviderRegistry.create(
    "arena.ai",
    "https://api.arena.ai/v1",
    "arena_testkey",
  );
  assert.equal(provider.id, "arena.ai");
  assert.equal(provider.name, "Arena.ai");

  const alias = globalProviderRegistry.create(
    "arena",
    "https://api.arena.ai/v1",
    "arena_testkey",
  );
  assert.equal(alias.id, "arena.ai");
});

test("Arena.ai Provider: Dynamic model discovery merges live API catalog", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "arena-next-experimental",
              name: "Arena Next Experimental",
              context_window: 500000,
            },
            { id: "arena-agent-v1", display_name: "Arena Agent V1" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new ArenaAIProvider(
      "https://api.arena.ai/v1",
      "arena_testkey",
    );
    const models = await provider.getModels();

    assert.ok(models.length >= 5, "Merged live API models with built-in catalog");
    const custom = models.find((m) => m.id === "arena-next-experimental");
    assert.ok(custom, "Live API model exists");
    assert.equal(custom.name, "Arena Next Experimental");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Arena.ai Provider: Capability-aware request parameter filtering and tool calls", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody: any;
  try {
    globalThis.fetch = async (_url, options) => {
      if (options?.body) {
        sentBody = JSON.parse(String(options.body));
      }
      return new Response(
        JSON.stringify({
          id: "arena-123",
          choices: [{ message: { role: "assistant", content: "OK" } }],
          usage: { prompt_tokens: 15, completion_tokens: 3, total_tokens: 18 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new ArenaAIProvider(
      "https://api.arena.ai/v1",
      "arena_testkey",
    );

    await provider.chat({
      model: "arena-agent-v1",
      messages: [{ role: "user", content: "perform task" }],
      tools: [
        {
          name: "execute_command",
          description: "run command in sandbox",
          inputSchema: { type: "object" },
        },
      ],
      temperature: 0.3,
    });

    assert.ok(sentBody.tools, "Tools should be included for arena-agent-v1");
    assert.equal(sentBody.tools[0].function.name, "execute_command");
    assert.equal(sentBody.model, "arena-agent-v1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Arena.ai Provider: Normalizes 401 Unauthorized to AuthenticationError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Unauthorized: invalid_arena_key", { status: 401 });

    const provider = new ArenaAIProvider(
      "https://api.arena.ai/v1",
      "arena_invalid",
    );
    await assert.rejects(
      provider.chat({
        model: "arena-agent-v1",
        messages: [{ role: "user", content: "hi" }],
      }),
      (err) => err instanceof AuthenticationError && err.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Arena.ai Provider: Normalizes 429 Rate Limit to RateLimitError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Rate limit reached", { status: 429 });

    const provider = new ArenaAIProvider(
      "https://api.arena.ai/v1",
      "arena_valid",
    );
    await assert.rejects(
      provider.chat({
        model: "arena-agent-v1",
        messages: [{ role: "user", content: "hi" }],
      }),
      (err) =>
        err instanceof RateLimitError &&
        err.status === 429 &&
        err.retryable === true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Arena.ai Provider: verifyConnection checks endpoint without generating tokens", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "arena-agent-v1" }, { id: "arena-chat-v1" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("Unexpected endpoint");
    };

    const provider = new ArenaAIProvider(
      "https://api.arena.ai/v1",
      "arena_valid",
    );
    const result = await provider.verifyConnection();
    assert.equal(result.connected, true);
    assert.ok(result.modelCount >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Arena.ai Provider: verifyConnection returns connected false on 401 Unauthorized", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Unauthorized", { status: 401 });

    const provider = new ArenaAIProvider(
      "https://api.arena.ai/v1",
      "arena_badkey",
    );
    const result = await provider.verifyConnection();
    assert.equal(result.connected, false);
    assert.equal(result.modelCount, 0);
    assert.ok(result.message.includes("authentication failed"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Arena.ai Provider: testModel measures latency and output", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"O"}}]}\ndata: {"choices":[{"delta":{"content":"K"}}]}\ndata: [DONE]\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );

    const provider = new ArenaAIProvider(
      "https://api.arena.ai/v1",
      "arena_valid",
    );
    const result = await provider.testModel("arena-agent-v1");
    assert.equal(result.working, true);
    assert.equal(result.output, "OK");
    assert.ok(result.latencyMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
