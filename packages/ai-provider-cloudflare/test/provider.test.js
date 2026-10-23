'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');
const client = require('../lib/client');

test('registers cloudflare without exposing stored secrets', async t => {
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
      providers: async() => [{id: 'cloudflare', models: [{id: '@cf/openai/gpt-oss-20b', selected: true}]}],
      generate: async request => { registered.request = request; return {model: request.model, text: 'OK'} }
    },
    admin: {
      registerForm: definition => { registered.forms[definition.id] = definition },
      registerAction: definition => { registered.actions[definition.id] = definition }
    }
  };
  await plugin.register(ctx);
  assert.equal(registered.provider.id, 'cloudflare');
  assert.deepEqual(registered.provider.admin, {formId: 'settings', testActionId: 'test-connection'});
  assert.equal(Object.hasOwn(await registered.forms.settings.load(), 'apiKey'), false);
  await registered.forms.settings.submit({accountId: '0123456789abcdef0123456789abcdef'});
  assert.equal(await registered.provider.configured(), true);
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch });
  global.fetch = async(_url, init) => {
    assert.equal(JSON.parse(init.body).model, 'custom-model');
    return {ok: true, json: async() => ({choices: [{message: {content: 'OK'}}]})};
  };
  await registered.forms.settings.submit({accountId: '0123456789abcdef0123456789abcdef', modelId: 'custom-model'});
  assert.equal((await registered.provider.generate({model: 'custom',
    messages: [{role: 'user', content: 'Hello'}]}, {})).model, 'custom-model');
  assert.deepEqual(await registered.actions['test-connection'].handler({model: '@cf/openai/gpt-oss-20b'}),
    {message: '连接成功：@cf/openai/gpt-oss-20b'});
  assert.equal(registered.request.provider, 'cloudflare');
});

test('sends cloudflare request with documented protocol', async() => {
  const result = await client.generate({
    apiKey: 'test-key', accountId: '0123456789abcdef0123456789abcdef',
    request: {model: 'model-x', messages: [{role: 'user', content: 'Hello'}]},
    fetchImpl: async(url, init) => {
      assert.equal(url, client.baseUrl('0123456789abcdef0123456789abcdef') + '/chat/completions');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer test-key');
      return {ok: true, json: async() => ({choices: [{message: {content: 'OK'}}], usage: {total_tokens: 2}})};
    }
  });
  assert.equal(result.text, 'OK');
  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.model, 'model-x');
  assert.throws(() => client.baseUrl('not-an-account-id'), /Account ID/);
});
