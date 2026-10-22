'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');

test('registers provider and keeps saved API keys out of admin form values', async() => {
  const registered = {forms: {}, actions: {}};
  const credentials = new Map([['apiKey', 'sk-saved']]);
  const ctx = {
    ai: {
      credentials: {
        get: async name => credentials.get(name),
        has: async name => credentials.has(name),
        set: async(name, value) => credentials.set(name, value)
      },
      registerProvider: definition => { registered.provider = definition },
      providers: async() => [{id: 'openai', models: [{id: 'gpt-5-mini', selected: true}]}],
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
  assert.equal(registered.provider.id, 'openai');
  assert.deepEqual(await registered.forms.settings.load(), {baseUrl: 'https://api.openai.com/v1'});
  assert.equal(await registered.provider.configured(), true);
  assert.equal(Object.hasOwn(await registered.forms.settings.load(), 'apiKey'), false);
  await registered.forms.settings.submit({baseUrl: 'https://api.openai.com/v1/'});
  assert.equal(credentials.get('apiKey'), 'sk-saved');
  assert.deepEqual(await registered.actions['test-connection'].handler(), {message: '连接成功：gpt-5-mini'});
  assert.equal(registered.testRequest.model, 'gpt-5-mini');
});
