'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');

test('registers four editor actions backed by authenticated admin actions', async() => {
  const registered = {actions: [], editorActions: [], forms: []};
  const ctx = {
    ai: {
      credentials: {get: async() => undefined, set: async() => {}},
      generate: async() => ({text: 'Generated'})
    },
    admin: {
      registerPanel() {}, registerPage() {},
      registerForm(value) { registered.forms.push(value) },
      registerAction(value) { registered.actions.push(value) },
      registerEditorAction(value) { registered.editorActions.push(value) }
    }
  };
  await plugin.register(ctx);
  assert.deepEqual(registered.editorActions.map(item => item.id), ['summary', 'title', 'rewrite', 'translate']);
  assert.deepEqual(registered.editorActions.map(item => item.action),
    ['generate-summary', 'generate-title', 'generate-rewrite', 'generate-translate']);
  assert.equal((await registered.forms[0].load()).language, 'English');
});
