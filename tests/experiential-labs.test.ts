import assert from "node:assert/strict";
import { test } from "node:test";
import { ExperientialLabsProvider } from "../packages/ai/experiential-labs";
import {
  AuthenticationError,
  RateLimitError,
  ProviderError,
} from "../packages/ai/errors";
import { PROMOTIONAL_MODELS, globalModelCatalog } from "../packages/ai/models";

test("Experiential Labs Provider: Promotional models are present and have valid metadata", () => {
  const models = PROMOTIONAL_MODELS;
  assert.ok(models.length >= 3, "At least 3 promotional models defined");

  const astra = models.find((m) => m.id === "gpt-6-astra");
  assert.ok(astra, "GPT-6 Astra is defined");
  assert.equal(astra.displayName, "GPT-6 Astra");
  assert.equal(astra.supportsTools, true);
  assert.equal(astra.supportsStreaming, true);
  assert.equal(astra.contextWindowFormatted, "1.05M");

  const qwen = models.find((m) => m.id === "qwen-3.8-27b");
  assert.ok(qwen, "Qwen3.8 27B is defined");
  assert.equal(qwen.supportsTools, true);
  assert.equal(qwen.contextWindowFormatted, "1M");

  const deepseek = models.find((m) => m.id === "deepseek-v4-flash");
  assert.ok(deepseek, "DeepSeek V4 Flash is defined");
  assert.equal(deepseek.contextWindowFormatted, "1.05M");
});

test("Experiential Labs Provider: Dynamic model discovery merges live API catalog", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "custom-claude-3-7-sonnet",
              name: "Claude 3.7 Sonnet",
              context_window: 200000,
            },
            { id: "gpt-6-astra", display_name: "GPT-6 Astra" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_testkey",
    );
    const models = await provider.getModels();

    assert.ok(
      models.length >= 4,
      "Merged live API models with promotional catalog",
    );
    const custom = models.find((m) => m.id === "custom-claude-3-7-sonnet");
    assert.ok(custom, "Live API model exists");
    assert.equal(custom.name, "Claude 3.7 Sonnet");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Capability-aware request parameter filtering", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody: any;
  try {
    globalThis.fetch = async (_url, options) => {
      if (options?.body) {
        sentBody = JSON.parse(String(options.body));
      }
      return new Response(
        JSON.stringify({
          id: "chat-123",
          choices: [{ message: { role: "assistant", content: "OK" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_testkey",
    );

    // Test 1: Model with tools
    await provider.chat({
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          name: "read_file",
          description: "read",
          inputSchema: { type: "object" },
        },
      ],
      temperature: 0.2,
    });

    assert.ok(sentBody.tools, "Tools should be included for gpt-6-astra");
    assert.equal(sentBody.tools[0].function.name, "read_file");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Normalizes 401 Unauthorized to AuthenticationError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Unauthorized: invalid_key", { status: 401 });

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_invalid",
    );
    await assert.rejects(
      provider.chat({
        model: "gpt-6-astra",
        messages: [{ role: "user", content: "hi" }],
      }),
      (err) => err instanceof AuthenticationError && err.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Normalizes 429 Rate Limit to RateLimitError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Rate limit reached", { status: 429 });

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    await assert.rejects(
      provider.chat({
        model: "gpt-6-astra",
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

test("Experiential Labs Provider: verifyConnection tests endpoint without generating tokens", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "gpt-6-astra" }, { id: "qwen-3.8-27b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("Unexpected endpoint");
    };

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    const result = await provider.verifyConnection();
    assert.equal(result.connected, true);
    assert.ok(result.modelCount >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: verifyConnection returns connected false on 401 Unauthorized", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Unauthorized", { status: 401 });

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_badkey",
    );
    const result = await provider.verifyConnection();
    assert.equal(result.connected, false);
    assert.equal(result.modelCount, 0);
    assert.ok(result.message.includes("authentication failed"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: testModel measures latency and first token", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"O"}}]}\ndata: {"choices":[{"delta":{"content":"K"}}]}\ndata: [DONE]\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    const result = await provider.testModel("gpt-6-astra");
    assert.equal(result.working, true);
    assert.equal(result.output, "OK");
    assert.ok(result.latencyMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Lists all free models from catalog and API", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );

    const freeModels = await provider.getFreeModels();
    assert.ok(
      freeModels.length >= 8,
      `Expected at least 8 free models, got ${freeModels.length}`,
    );

    const requiredFreeIds = [
      "gpt-6-astra",
      "gpt-5.6-luna",
      "qwen-3.8-27b",
      "deepseek-v4-flash",
      "deepseek-r1-distill-qwen-32b",
      "meta-llama-3.3-70b-instruct",
      "qwen-2.5-coder-32b",
      "mistral-small-3-24b",
    ];

    for (const requiredId of requiredFreeIds) {
      const found = freeModels.find((m) => m.id === requiredId);
      assert.ok(
        found,
        `Free model ${requiredId} must be present in free models list`,
      );
      assert.equal(
        found.isPromotional,
        true,
        `Model ${requiredId} must have isPromotional = true`,
      );
    }

    // Verify catalog getFreeModels
    const catalogFree = globalModelCatalog.getFreeModels();
    assert.ok(catalogFree.length >= 8, "Catalog must return all free models");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiential Labs Provider: Correctly flags live API models with free pricing as promotional", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "new-experimental-free-model",
              name: "New Experimental Free Model",
              pricing: { free: true, input: 0, output: 0 },
              context_window: 256000,
            },
            {
              id: "new-paid-model",
              name: "New Paid Model",
              pricing: { free: false, input: 1.5, output: 5.0 },
              context_window: 128000,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new ExperientialLabsProvider(
      "https://api.experientiallabs.ai/v1",
      "xpl_valid",
    );
    const freeModels = await provider.getFreeModels();
    const liveFree = freeModels.find((m) => m.id === "new-experimental-free-model");
    assert.ok(liveFree, "Dynamic live API free model should be included in free models");
    assert.equal(liveFree.isPromotional, true);

    const livePaid = freeModels.find((m) => m.id === "new-paid-model");
    assert.equal(livePaid, undefined, "Paid model must not be included in free models");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

