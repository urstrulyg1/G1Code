import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAICompatibleProvider } from '../packages/ai/providers/openai-compatible';

test('provider parses streaming content and tool calls', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\ndata: [DONE]\n', { headers: { 'content-type': 'text/event-stream' } });
  try {
    const chunks = [];
    for await (const chunk of new OpenAICompatibleProvider('https://example.test/v1', 'secret').streamChat({ model: 'configured', messages: [{ role: 'user', content: 'hi' }] })) chunks.push(chunk);
    assert.equal(chunks[0].content, 'Hello');
    assert.equal(chunks.at(-1)?.done, true);
    assert.equal(chunks.at(-1)?.toolCalls?.[0].name, 'read_file');
  } finally { globalThis.fetch = originalFetch; }
});

test('provider normalizes authentication failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('unauthorized', { status: 401 });
  try { await assert.rejects(new OpenAICompatibleProvider('https://example.test/v1', 'secret').chat({ model: 'configured', messages: [{ role: 'user', content: 'hi' }] }), /Provider request failed \(401\)/); }
  finally { globalThis.fetch = originalFetch; }
});
