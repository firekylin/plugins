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
  assert.deepEqual(registered.provider.models.find(model => model.id === 'gemini-3.1-flash-image').capabilities, ['image']);
  assert.deepEqual(registered.provider.admin, {formId: 'settings', testActionId: 'test-connection'});
  assert.equal(Object.hasOwn(await registered.forms.settings.load(), 'apiKey'), false);
  await registered.forms.settings.submit({baseUrl: client.DEFAULT_BASE_URL, modelId: 'model-x'});
  assert.equal(await registered.provider.configured(), true);
  assert.deepEqual(await registered.actions['test-connection'].handler({model: 'gemini-3-flash-preview'}),
    {message: '连接成功：gemini-3-flash-preview'});
  assert.equal(registered.request.provider, 'google-gemini');
  await registered.actions['test-connection'].handler({model: 'gemini-3.1-flash-image'});
  assert.equal(registered.request.model, 'gemini-3-flash-preview');
});

test('sends google-gemini request with documented protocol', async() => {
  const result = await client.generate({
    images: require('../../../test/helpers/ai-images'),
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

test('generates images and preserves Gemini MIME type and base64 data', async() => {
  const result = await client.generate({
    images: require('../../../test/helpers/ai-images'),
    apiKey: 'test-key', baseUrl: client.DEFAULT_BASE_URL,
    request: {model: 'gemini-3.1-flash-image', capability: 'image', messages: [{role: 'user', content: 'Draw a cat'}]},
    fetchImpl: async(url, init) => {
      assert.equal(url, client.DEFAULT_BASE_URL + '/models/gemini-3.1-flash-image:generateContent');
      const body = JSON.parse(init.body);
      assert.deepEqual(body.contents, [{role: 'user', parts: [{text: 'Draw a cat'}]}]);
      assert.deepEqual(body.generationConfig, {responseModalities: ['IMAGE']});
      return {ok: true, json: async() => ({
        candidates: [{content: {parts: [{inlineData: {mimeType: 'image/png', data: 'aW1hZ2U='}}]}}],
        usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13}
      })};
    }
  });
  assert.deepEqual(result.images, [{mimeType: 'image/png', data: 'aW1hZ2U='}]);
  assert.deepEqual(result.usage, {prompt_tokens: 5, completion_tokens: 8, total_tokens: 13});
});

test('rejects image requests without image output', async() => {
  await assert.rejects(client.generate({
    images: require('../../../test/helpers/ai-images'),
    apiKey: 'test-key', baseUrl: client.DEFAULT_BASE_URL,
    request: {model: 'gemini-3.1-flash-image', capability: 'image', messages: [{role: 'user', content: 'Draw a cat'}]},
    fetchImpl: async() => ({ok: true, json: async() => ({candidates: [{content: {parts: [{text: 'No image'}]}}]})})
  }), /returned no image output/);
});
