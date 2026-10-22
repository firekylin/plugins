'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');
const client = require('../lib/client');

test('registers anthropic without exposing stored secrets', async() => {
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
      providers: async() => [{id: 'anthropic', models: [{id: 'claude-sonnet-4-6', selected: true}]}],
      generate: async request => { registered.request = request; return {model: request.model, text: 'OK'} }
    },
    admin: {
      registerForm: definition => { registered.forms[definition.id] = definition },
      registerAction: definition => { registered.actions[definition.id] = definition }
    }
  };
  await plugin.register(ctx);
  assert.equal(registered.provider.id, 'anthropic');
  assert.deepEqual(registered.provider.admin, {formId: 'settings', testActionId: 'test-connection'});
  assert.equal(Object.hasOwn(await registered.forms.settings.load(), 'apiKey'), false);
  await registered.forms.settings.submit({baseUrl: client.DEFAULT_BASE_URL, modelId: 'model-x'});
  assert.equal(await registered.provider.configured(), true);
  assert.deepEqual(await registered.actions['test-connection'].handler({model: 'claude-sonnet-4-6'}),
    {message: '连接成功：claude-sonnet-4-6'});
  assert.equal(registered.request.provider, 'anthropic');
});

test('sends anthropic request with documented protocol', async() => {
  const result = await client.generate({
    apiKey: 'test-key', baseUrl: client.DEFAULT_BASE_URL,
    request: {model: 'model-x', messages: [
      {role: 'system', content: 'Be concise'}, {role: 'user', content: 'Hello'}]},
    fetchImpl: async(url, init) => {
      assert.equal(url, client.DEFAULT_BASE_URL + '/messages');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['x-api-key'], 'test-key');
      assert.equal(init.headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(init.body);
      assert.equal(body.system, 'Be concise');
      assert.deepEqual(body.messages, [{role: 'user', content: 'Hello'}]);
      assert.ok(body.max_tokens > 0);
      return {ok: true, json: async() => ({content: [{type: 'text', text: 'OK'}], usage: {input_tokens: 1}})};
    }
  });
  assert.equal(result.text, 'OK');
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.model, 'model-x');
});
