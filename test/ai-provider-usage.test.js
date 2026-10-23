'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const chatProviders = ['cloudflare', 'deepseek', 'doubao', 'grok', 'kimi', 'qianwen', 'vercel-ai-gateway', 'xiaomi-mimo'];
const chat = usage => ({choices: [{message: {content: 'OK'}}], usage});
const cases = [
  ...chatProviders.map(id => ({id, payload: chat,
    usage: {prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: {cached_tokens: 6},
      completion_tokens_details: {reasoning_tokens: 2}, ...(id === 'deepseek' ? {prompt_cache_hit_tokens: 7} : {})},
    expected: {inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadTokens: id === 'deepseek' ? 7 : 6,
      cacheWriteTokens: null, reasoningTokens: 2}, zero: {prompt_tokens: 0, completion_tokens: 0}})),
  {id: 'openai', payload: usage => ({output_text: 'OK', usage}),
    usage: {input_tokens: 10, output_tokens: 4, input_tokens_details: {cached_tokens: 6}, output_tokens_details: {reasoning_tokens: 2}},
    expected: {inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadTokens: 6, cacheWriteTokens: null, reasoningTokens: 2},
    zero: {input_tokens: 0, output_tokens: 0}},
  {id: 'anthropic', payload: usage => ({content: [{type: 'text', text: 'OK'}], usage}),
    usage: {input_tokens: 10, output_tokens: 4, cache_creation_input_tokens: 3, cache_read_input_tokens: 6},
    expected: {inputTokens: 19, outputTokens: 4, totalTokens: 23, cacheReadTokens: 6, cacheWriteTokens: 3, reasoningTokens: null},
    zero: {input_tokens: 0, output_tokens: 0}},
  {id: 'google-gemini', payload: usageMetadata => ({candidates: [{content: {parts: [{text: 'OK'}]}}], usageMetadata}),
    usage: {promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2, cachedContentTokenCount: 6, totalTokenCount: 16},
    expected: {inputTokens: 10, outputTokens: 6, totalTokens: 16, cacheReadTokens: 6, cacheWriteTokens: null, reasoningTokens: 2},
    zero: {promptTokenCount: 0, candidatesTokenCount: 0}},
  {id: 'ollama', payload: usage => ({message: {content: 'OK'}, ...usage}),
    usage: {prompt_eval_count: 10, eval_count: 4},
    expected: {inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null},
    zero: {prompt_eval_count: 0, eval_count: 0}}
];
function generate(id, payload, {ok = true} = {}) {
  return require(`../packages/ai-provider-${id}/lib/client`).generate({apiKey: 'test', accountId: 'a'.repeat(32),
    request: {model: 'test', messages: [{role: 'user', content: 'hello'}]}, fetchImpl: async() => ({ok, status: ok ? 200 : 503,
      headers: new Headers({'x-request-id': 'request-id', Authorization: 'not-attached'}), json: async() => payload})});
}
for (const fixture of cases) {
  test(`${fixture.id}: maps native usage and preserves legacy counts`, async() => {
    const payload = fixture.payload(fixture.usage);
    const result = await generate(fixture.id, payload);
    assert.deepEqual(result.usageDetails, fixture.expected);
    assert.equal(result.providerRequestId, 'request-id');
    assert.equal(result.headers, undefined);
    if (payload.usage) assert.equal(result.usage, payload.usage);
    if (fixture.id === 'google-gemini') assert.deepEqual(result.usage, {prompt_tokens: 10, completion_tokens: 4, total_tokens: 16});
    if (fixture.id === 'ollama') assert.deepEqual(result.usage, {prompt_tokens: 10, completion_tokens: 4, total_tokens: 14});
  });
  test(`${fixture.id}: missing is unknown and zero is known`, async() => {
    const missing = await generate(fixture.id, fixture.payload());
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) assert.equal(missing.usageDetails[key], null);
    const zero = await generate(fixture.id, fixture.payload(fixture.zero));
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) assert.equal(zero.usageDetails[key], 0);
  });
  test(`${fixture.id}: HTTP failures retain request IDs without response bodies`, async() => {
    await assert.rejects(generate(fixture.id, {}, {ok: false}), error => {
      assert.equal(error.providerRequestId, 'request-id');
      assert.equal(error.response, undefined);
      return true;
    });
  });
  test(`${fixture.id}: empty output retains already reported usage`, async() => {
    const payload = fixture.id === 'google-gemini' ? {usageMetadata: fixture.usage} : fixture.id === 'ollama'
      ? fixture.usage : {usage: fixture.usage};
    await assert.rejects(generate(fixture.id, payload), error => {
      assert.deepEqual(error.usageDetails, fixture.expected);
      assert.equal(error.providerRequestId, 'request-id');
      return true;
    });
  });
}
