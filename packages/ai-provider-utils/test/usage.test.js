'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createUsageAdapter, sumTokens, chatUsage, responsesUsage} = require('..');
test('missing, invalid and zero values remain distinct; totals require both counts', () => {
  for (const value of [undefined, null, -1, NaN, Infinity, 1.5, '4']) {
    const result = chatUsage.metadata({prompt_tokens: value, completion_tokens: 2}).usageDetails;
    assert.equal(result.inputTokens, null);
    assert.equal(result.totalTokens, null);
  }
  assert.equal(chatUsage.metadata({prompt_tokens: 0, completion_tokens: 0}).usageDetails.totalTokens, 0);
  assert.equal(chatUsage.metadata({total_tokens: 9}).usageDetails.totalTokens, 9);
  assert.equal(sumTokens(Number.MAX_SAFE_INTEGER, 1), null);
  assert.equal(sumTokens(3, null), null);
});
test('protocol mappings retain cache and reasoning details without adding them to totals again', () => {
  const chat = chatUsage.metadata({prompt_tokens: 10, completion_tokens: 4,
    prompt_tokens_details: {cached_tokens: 6}, completion_tokens_details: {reasoning_tokens: 2}}).usageDetails;
  assert.deepEqual(chat, {inputTokens: 10, outputTokens: 4, totalTokens: 14,
    cacheReadTokens: 6, cacheWriteTokens: null, reasoningTokens: 2});
  const response = responsesUsage.metadata({input_tokens: 10, output_tokens: 4,
    input_tokens_details: {cached_tokens: 6}, output_tokens_details: {reasoning_tokens: 2}}).usageDetails;
  assert.deepEqual(response, chat);
});
test('declarations support custom accessors, fallback paths and immutable independent mappings', () => {
  const fields = {inputTokens: ['primary', 'fallback'], outputTokens: u => sumTokens(u.visible, u.hidden ?? 0)};
  const adapter = createUsageAdapter(fields, {requestIdHeaders: ['custom-request-id']});
  fields.inputTokens.push('should-not-read');
  fields.outputTokens = () => 999;
  const result = adapter.metadata({fallback: 0, visible: 2, hidden: 3},
    {headers: new Headers({'custom-request-id': 'id', Authorization: 'do-not-return'})});
  assert.equal(result.usageDetails.inputTokens, 0);
  assert.equal(result.usageDetails.totalTokens, 5);
  assert.equal(result.providerRequestId, 'id');
  assert.equal(result.headers, undefined);
  assert.equal(adapter.metadata({'should-not-read': 4, visible: 1}).usageDetails.inputTokens, null);
  assert.equal(chatUsage.metadata({primary: 4}).usageDetails.inputTokens, null);
});
test('failure uses the same normalization and only attaches request ID and known usage metadata', () => {
  const response = {headers: new Headers({'request-id': 'failed'}), secret: 'not-attached'};
  const error = chatUsage.failure('original error', response, {prompt_tokens: 3, completion_tokens: 1});
  assert.equal(error.message, 'original error');
  assert.equal(error.providerRequestId, 'failed');
  assert.equal(error.usageDetails.totalTokens, 4);
  assert.equal(error.response, undefined);
  assert.equal(chatUsage.failure('HTTP error', response).usageDetails, undefined);
});
