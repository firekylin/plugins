'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createParser = require('../lib/stream-parser');
test('Gemini parser preserves native usage and separately normalizes result usage after completion', () => {
  const parser = createParser(), parse = event => parser.parse(JSON.stringify(event));
  assert.deepEqual(parse({candidates: [{content: {parts: [{thought: true, text: 'private'}, {text: 'hello'}]}, finishReason: 'STOP'}]}), {text: 'hello', done: true});
  const usageMetadata = {promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 6, thoughtsTokenCount: 1};
  const update = parse({usageMetadata});
  assert.deepEqual(update.usage, usageMetadata);
  assert.deepEqual(update.resultUsage, {prompt_tokens: 2, completion_tokens: 3, total_tokens: 6});
  assert.equal(parser.end(), undefined);
});
test('Gemini parser defers incomplete failure until trailing usage and isolates request state', () => {
  const parser = createParser();
  assert.equal(parser.parse(JSON.stringify({candidates: [{finishReason: 'MAX_TOKENS'}]})).done, true);
  assert.equal(parser.parse(JSON.stringify({usageMetadata: {totalTokenCount: 5}})).usage.totalTokenCount, 5);
  assert.match(parser.end().error, /incomplete/);
  assert.equal(createParser().end(), undefined);
  assert.equal(parser.parse(JSON.stringify({promptFeedback: {blockReason: 'SAFETY'}})).error, 'Gemini stream failed');
  assert.equal(parser.parse(JSON.stringify({error: {message: 'secret'}})).error, 'Gemini stream failed');
  assert.throws(() => parser.parse('{invalid'), SyntaxError);
});
