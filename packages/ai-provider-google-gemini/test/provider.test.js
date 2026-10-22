'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');
const client = require('../lib/client');

test('registers google-gemini without exposing stored secrets', async() => {
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
      providers: async() => [{id: 'google-gemini', models: [{id: 'gemini-3-flash-preview', selected: true}]}],
      generate: async request => { registered.request = request; return {model: request.model, text: 'OK'} }
    },
    admin: {
      registerForm: definition => { registered.forms[definition.id] = definition },
      registerAction: definition => { registered.actions[definition.id] = definition }
    }
  };
  await plugin.register(ctx);
  assert.equal(registered.provider.id, 'google-gemini');
  assert.deepEqual(registered.provider.admin, {formId: 'settings', testActionId: 'test-connection'});
  assert.equal(Object.hasOwn(await registered.forms.settings.load(), 'apiKey'), false);
  await registered.forms.settings.submit({baseUrl: client.DEFAULT_BASE_URL, modelId: 'model-x'});
  assert.equal(await registered.provider.configured(), true);
  assert.deepEqual(await registered.actions['test-connection'].handler({model: 'gemini-3-flash-preview'}),
    {message: '连接成功：gemini-3-flash-preview'});
  assert.equal(registered.request.provider, 'google-gemini');
});

test('sends google-gemini request with documented protocol', async() => {
  const result = await client.generate({
    apiKey: 'test-key', baseUrl: client.DEFAULT_BASE_URL,
    request: {model: 'model-x', messages: [
      {role: 'system', content: 'Be concise'}, {role: 'user', content: 'Hello'},
      {role: 'assistant', content: 'Hi'}]},
    fetchImpl: async(url, init) => {
      assert.equal(url, client.DEFAULT_BASE_URL + '/models/model-x:generateContent');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['x-goog-api-key'], 'test-key');
      const body = JSON.parse(init.body);
      assert.deepEqual(body.systemInstruction, {parts: [{text: 'Be concise'}]});
      assert.deepEqual(body.contents, [
        {role: 'user', parts: [{text: 'Hello'}]}, {role: 'model', parts: [{text: 'Hi'}]}
      ]);
      return {ok: true, json: async() => ({candidates: [{content: {parts: [{text: 'OK'}]}}], usageMetadata: {totalTokenCount: 2}})};
    }
  });
  assert.equal(result.text, 'OK');
  assert.equal(result.provider, 'google-gemini');
  assert.equal(result.model, 'model-x');
});
