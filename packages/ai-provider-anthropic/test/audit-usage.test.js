'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {generate} = require('../lib/client');
const {metadata} = require('../lib/usage');
test('usage keeps missing counts unknown and zero counts known', () => {
  const missing = metadata({}, {});
  assert.equal(missing.usageDetails.inputTokens, null);
  assert.equal(missing.usageDetails.outputTokens, null);
  assert.equal(missing.usageDetails.totalTokens, null);
  assert.deepEqual(metadata({prompt_tokens: 0, completion_tokens: 0}, {}).usageDetails,
    {inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null});
  const value = metadata({prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: {cached_tokens: 5},
    completion_tokens_details: {reasoning_tokens: 2}}, {headers: new Headers({'x-request-id': 'request-1'})});
  assert.equal(value.usageDetails.totalTokens, 14);
  assert.equal(value.usageDetails.cacheReadTokens, 5);
  assert.equal(value.usageDetails.reasoningTokens, 2);
  assert.equal(value.providerRequestId, 'request-1');
});
test('provider publishes normalized metadata without fabricated tokens', async() => {
  const payload = {choices: [{message: {content: 'OK'}}], output_text: 'OK', content: [{type: 'text', text: 'OK'}],
    candidates: [{content: {parts: [{text: 'OK'}]}}], message: {content: 'OK'}};
  const result = await generate({apiKey: 'test', accountId: 'a'.repeat(32), request: {model: 'test',
    messages: [{role: 'user', content: 'hello'}]}, fetchImpl: async() => ({ok: true,
    headers: new Headers({'x-request-id': 'test-id'}), json: async() => payload})});
  assert.equal(result.usageDetails.inputTokens, null);
  assert.equal(result.usageDetails.outputTokens, null);
  assert.equal(result.usageDetails.totalTokens, null);
  assert.equal(result.providerRequestId, 'test-id');
});
test('native cache and reasoning counts do not double-count totals', () => {
  const anthropic = metadata({input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20,
    cache_creation_input_tokens: 3}, {}, 'anthropic').usageDetails;
  assert.equal(anthropic.inputTokens, 33);
  assert.equal(anthropic.totalTokens, 38);
  const gemini = metadata({promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2,
    cachedContentTokenCount: 6, totalTokenCount: 16}, {}, 'gemini').usageDetails;
  assert.equal(gemini.outputTokens, 6);
  assert.equal(gemini.totalTokens, 16);
});

test('upstream failures preserve request IDs without attaching full responses', async() => {
  await assert.rejects(generate({apiKey: 'test', accountId: 'a'.repeat(32),
    request: {model: 'test', messages: [{role: 'user', content: 'hello'}]},
    fetchImpl: async() => ({ok: false, status: 503, headers: new Headers({'x-request-id': 'failed-request'}),
      json: async() => ({error: {message: 'service unavailable'}})})}), error => {
    assert.equal(error.providerRequestId, 'failed-request');
    assert.equal(error.response, undefined);
    return true;
  });
});
