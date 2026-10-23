'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');
const client = require('../lib/client');

test('registers vercel-ai-gateway with a private API key and a connection action', async t => {
  const registered = {forms: {}, actions: {}};
  const credentials = new Map([['apiKey', 'saved-key']]);
  const ctx = {
    ai: {
      credentials: {
        get: async name => credentials.get(name),
        has: async name => credentials.has(name),
        set: async(name, value) => credentials.set(name, value)
      },
      registerProvider: definition => { registered.provider = definition },
      providers: async() => [{id: 'vercel-ai-gateway', models: [{id: 'custom', selected: true}]}],
      generate: async request => {
        registered.request = request;
        return registered.provider.generate(request, {});
      }
    },
    admin: {
      registerForm: definition => { registered.forms[definition.id] = definition },
      registerAction: definition => { registered.actions[definition.id] = definition }
    }
  };
  await plugin.register(ctx);
  assert.equal(registered.provider.id, 'vercel-ai-gateway');
  assert.deepEqual(registered.provider.admin, {formId: 'settings', testActionId: 'test-connection'});
  assert.equal(await registered.provider.configured(), true);
  assert.equal(Object.hasOwn(await registered.forms.settings.load(), 'apiKey'), false);
  await registered.forms.settings.submit({baseUrl: client.DEFAULT_BASE_URL, modelId: 'my-model'});
  assert.equal(credentials.get('apiKey'), 'saved-key');
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch });
  global.fetch = async(_url, init) => {
    assert.equal(JSON.parse(init.body).model, 'my-model');
    return {ok: true, json: async() => ({choices: [{message: {content: 'OK'}}]})};
  };
  assert.equal((await registered.provider.generate({model: 'custom',
    messages: [{role: 'user', content: 'Hello'}]}, {})).model, 'my-model');
  assert.deepEqual(await registered.actions['test-connection'].handler({model: 'custom'}),
    {message: '连接成功：my-model'});
  assert.equal(registered.request.provider, 'vercel-ai-gateway');
  await assert.rejects(() => registered.actions['test-connection'].handler({model: 'unknown'}), /Invalid/);
});

test('sends a non-streaming chat request and normalizes its response', async() => {
  const result = await client.generate({
    apiKey: 'test-key', baseUrl: client.DEFAULT_BASE_URL,
    request: {model: 'anthropic/claude-sonnet-4.6', messages: [{role: 'user', content: 'Hello'}]},
    fetchImpl: async(url, init) => {
      assert.equal(url, client.DEFAULT_BASE_URL + '/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer test-key');
      assert.equal(JSON.parse(init.body).stream, false);
      return {ok: true, json: async() => ({choices: [{message: {content: 'OK'}}], usage: {total_tokens: 2}})};
    }
  });
  assert.deepEqual((({usageDetails, providerRequestId, ...legacy}) => legacy)(result), {text: 'OK', provider: 'vercel-ai-gateway', model: 'anthropic/claude-sonnet-4.6',
    usage: {total_tokens: 2}});
  await assert.rejects(() => client.generate({request: {model: 'x', messages: []}}), /key is not configured/);
  assert.throws(() => client.normalizeBaseUrl('http://example.com/v1'), /HTTPS/);
});
