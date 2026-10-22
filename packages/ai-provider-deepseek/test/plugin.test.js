'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');

test('requires the Firekylin AI service', async() => {
  await assert.rejects(() => plugin.register({}), /requires the Firekylin AI service API/);
});

test('registers provider and configures it without returning saved API keys', async() => {
  const registered = {forms: {}, actions: {}};
  const credentials = new Map([['apiKey', 'saved-secret']]);
  const ctx = {
    ai: {
      credentials: {
        get: async name => credentials.get(name),
        has: async name => credentials.has(name),
        set: async(name, value) => credentials.set(name, value)
      },
      registerProvider: definition => { registered.provider = definition },
      providers: async() => [{id: 'deepseek', models: [{id: 'deepseek-v4-pro', selected: true}]}],
      generate: async request => { registered.testRequest = request; return {model: request.model, text: 'OK'} }
    },
    admin: {
      registerPanel: definition => { registered.panel = definition },
      registerPage: definition => { registered.page = definition },
      registerForm: definition => { registered.forms[definition.id] = definition },
      registerAction: definition => { registered.actions[definition.id] = definition }
    }
  };
  await plugin.register(ctx);
  assert.equal(registered.provider.id, 'deepseek');
  assert.deepEqual(registered.provider.admin, {formId: 'settings', testActionId: 'test-connection'});
  assert.equal(registered.page.menu, false);
  assert.deepEqual(await registered.forms.settings.load(), {baseUrl: 'https://api.deepseek.com'});
  assert.equal(await registered.provider.configured(), true);
  await registered.forms.settings.submit({baseUrl: 'https://api.deepseek.com/'});
  assert.equal(credentials.get('apiKey'), 'saved-secret');
  assert.equal(credentials.get('baseUrl'), 'https://api.deepseek.com');
  assert.deepEqual(await registered.actions['test-connection'].handler({model: 'deepseek-flash'}),
    {message: '连接成功：deepseek-flash'});
  assert.equal(registered.testRequest.provider, 'deepseek');
  assert.equal(registered.testRequest.model, 'deepseek-flash');
  assert.equal(registered.testRequest.disableThinking, true);
  assert.equal(registered.testRequest.maxOutputTokens, 32);
  await assert.rejects(() => registered.actions['test-connection'].handler({model: 'invalid'}),
    /Invalid DeepSeek model/);
});
