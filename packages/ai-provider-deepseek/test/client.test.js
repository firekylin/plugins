'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeBaseUrl, generate} = require('../lib/client');

test('normalizes HTTPS endpoints and rejects unsafe URL parts', () => {
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/'), 'https://api.deepseek.com');
  assert.throws(() => normalizeBaseUrl('http://api.deepseek.com'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:secret@example.com'), /Invalid/);
  assert.throws(() => normalizeBaseUrl('https://example.com/?key=secret'), /Invalid/);
});

test('calls DeepSeek Chat Completions with core request fields', async() => {
  let received;
  const result = await generate({
    apiKey: 'test-secret', request: {
      model: 'deepseek-flash', messages: [{role: 'user', content: 'Hello'}], maxOutputTokens: 20
    },
    fetchImpl: async(url, options) => {
      received = {url, options};
      return {ok: true, json: async() => ({
        choices: [{message: {content: 'Hi'}}], usage: {total_tokens: 3}
      })};
    }
  });
  assert.equal(received.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(received.options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(JSON.parse(received.options.body), {
    model: 'deepseek-flash', messages: [{role: 'user', content: 'Hello'}], stream: false, max_tokens: 20
  });
  assert.deepEqual((({usageDetails, providerRequestId, ...legacy}) => legacy)(result), {text: 'Hi', provider: 'deepseek', model: 'deepseek-flash', usage: {total_tokens: 3}});
  assert.doesNotMatch(JSON.stringify(result), /test-secret/);
});

test('does not leak provider response bodies on HTTP failures', async() => {
  await assert.rejects(() => generate({
    apiKey: 'test-secret', request: {model: 'deepseek-flash', messages: []},
    fetchImpl: async() => ({ok: false, status: 401, json: async() => ({error: {message: 'test-secret'}})})
  }), error => error.message === 'DeepSeek request failed (HTTP 401)');
});

test('disables thinking only for the connection probe', async() => {
  let body;
  await generate({apiKey: 'test-secret', request: {
    model: 'deepseek-flash', messages: [{role: 'user', content: 'Reply with OK only.'}],
    disableThinking: true, maxOutputTokens: 32
  }, fetchImpl: async(_url, options) => {
    body = JSON.parse(options.body);
    return {ok: true, json: async() => ({choices: [{message: {content: 'OK'}}]})};
  }});
  assert.deepEqual(body.thinking, {type: 'disabled'});
  assert.equal(body.max_tokens, 32);
});

test('rejects empty completions', async() => {
  await assert.rejects(() => generate({
    apiKey: 'test-secret', request: {model: 'deepseek-flash', messages: []},
    fetchImpl: async() => ({ok: true, json: async() => ({choices: [{message: {content: ''}}]})})
  }), /no text output/);
});
