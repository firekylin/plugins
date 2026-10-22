'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');
const client = require('../lib/client');

test('registers ollama without exposing stored secrets', async t => {
  const registered = {forms: {}, actions: {}};
  const credentials = new Map([]);
  const ctx = {
    ai: {
      credentials: {
        get: async name => credentials.get(name),
        has: async name => credentials.has(name),
        set: async(name, value) => credentials.set(name, value)
      },
      registerProvider: definition => { registered.provider = definition },
      providers: async() => [{id: 'ollama', models: [{id: 'local', selected: true}]}],
      generate: async request => { registered.request = request; return {model: request.model, text: 'OK'} }
    },
    admin: {
      registerForm: definition => { registered.forms[definition.id] = definition },
      registerAction: definition => { registered.actions[definition.id] = definition }
    }
  };
  await plugin.register(ctx);
  assert.equal(registered.provider.id, 'ollama');
  assert.deepEqual(registered.provider.admin, {formId: 'settings', testActionId: 'test-connection'});
  assert.equal(Object.hasOwn(await registered.forms.settings.load(), 'apiKey'), false);
  await registered.forms.settings.submit({baseUrl: client.DEFAULT_BASE_URL, modelId: 'llama3.2'});
  assert.equal(await registered.provider.configured(), true);
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch });
  global.fetch = async(_url, init) => {
    assert.equal(JSON.parse(init.body).model, 'llama3.2');
    return {ok: true, json: async() => ({message: {content: 'OK'}})};
  };
  assert.equal((await registered.provider.generate({model: 'local',
    messages: [{role: 'user', content: 'Hello'}]}, {})).model, 'llama3.2');
  assert.deepEqual(await registered.actions['test-connection'].handler({model: 'local'}),
    {message: '连接成功：local'});
  assert.equal(registered.request.provider, 'ollama');
});

test('sends ollama request with documented protocol', async() => {
  const result = await client.generate({
    baseUrl: client.DEFAULT_BASE_URL,
    request: {model: 'model-x', messages: [{role: 'user', content: 'Hello'}]},
    fetchImpl: async(url, init) => {
      assert.equal(url, client.DEFAULT_BASE_URL + '/api/chat');
      assert.equal(init.method, 'POST');

      return {ok: true, json: async() => ({message: {content: 'OK'}, prompt_eval_count: 1, eval_count: 1})};
    }
  });
  assert.equal(result.text, 'OK');
  assert.equal(result.provider, 'ollama');
  assert.equal(result.model, 'model-x');
  assert.throws(() => client.normalizeBaseUrl('http://example.com:11434'), /HTTPS or a loopback/);
});
