'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createParser = require('../lib/stream-parser');
test('Anthropic parser merges cumulative usage and emits text/terminal state without transport dependencies', () => {
  const parser = createParser(), parse = event => parser.parse(JSON.stringify(event));
  assert.deepEqual(parse({type: 'message_start', message: {usage: {input_tokens: 3, output_tokens: 1}}}).usage, {input_tokens: 3, output_tokens: 1});
  assert.equal(parse({type: 'content_block_delta', delta: {type: 'text_delta', text: 'hi'}}).text, 'hi');
  assert.equal(parse({type: 'content_block_delta', delta: {type: 'thinking_delta', thinking: 'private'}}).text, undefined);
  assert.deepEqual(parse({type: 'message_delta', usage: {output_tokens: 4}, delta: {stop_reason: 'end_turn'}}).usage, {input_tokens: 3, output_tokens: 4});
  assert.deepEqual(parse({type: 'message_stop'}), {done: true, stop: true});
  assert.equal(createParser().parse(JSON.stringify({type: 'message_stop'})).error, undefined);
});
test('Anthropic parser reports safe errors and incomplete generation', () => {
  const parser = createParser();
  parser.parse(JSON.stringify({type: 'message_delta', delta: {stop_reason: 'max_tokens'}}));
  assert.match(parser.parse(JSON.stringify({type: 'message_stop'})).error, /incomplete/);
  assert.equal(parser.parse(JSON.stringify({type: 'error', error: {message: 'secret'}})).error, 'Anthropic stream failed');
  assert.throws(() => parser.parse('{invalid'), SyntaxError);
});
