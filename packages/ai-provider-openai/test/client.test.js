'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeBaseUrl, outputText, generate} = require('../lib/client');

test('normalizes safe OpenAI-compatible base URLs', () => {
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.throws(() => normalizeBaseUrl('file:///tmp/openai'), /HTTP/);
  assert.throws(() => normalizeBaseUrl('https://user:secret@example.com/v1'), /Invalid/);
});

test('extracts text from Responses API output', () => {
  assert.equal(outputText({output: [{content: [{type: 'output_text', text: 'Hello'}]}]}), 'Hello');
});

test('calls the Responses API without exposing credentials in results', async() => {
  let received;
  const result = await generate({
    apiKey: 'sk-test', request: {model: 'gpt-5-mini', messages: [{role: 'user', content: 'Hello'}]},
    fetchImpl: async(url, options) => {
      received = {url, options};
      return {ok: true, json: async() => ({output_text: 'Hi', usage: {total_tokens: 2}})};
    }
  });
  assert.equal(received.url, 'https://api.openai.com/v1/responses');
  assert.equal(received.options.headers.Authorization, 'Bearer sk-test');
  assert.deepEqual(result, {text: 'Hi', provider: 'openai', model: 'gpt-5-mini', usage: {total_tokens: 2}});
  assert.doesNotMatch(JSON.stringify(result), /sk-test/);
});

test('turns provider errors into bounded failures', async() => {
  await assert.rejects(() => generate({
    apiKey: 'sk-test', request: {model: 'gpt-5-mini', messages: []},
    fetchImpl: async() => ({ok: false, status: 401, json: async() => ({error: {message: 'bad key'}})})
  }), /OpenAI request failed: bad key/);
});
