'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const plugin = require('../plugin');
const {SayService} = require('../lib/say-service');

function setup(t) {
  const forms = [];
  const pages = [];
  const noop = () => {};
  const settings = {enabled: true, pageSize: 20, authorId: 1, amapKey: 'private-map-key',
    apiKey: 'private-api-key-123456', wecomCorpId: 'corp', wecomCorpSecret: 'private-corp-secret',
    wecomToken: 'private-corp-token', wecomEncodingAESKey: 'a'.repeat(43),
    wechatAppId: 'wx_app', wechatAppSecret: 'private-wx-secret', wechatToken: 'private-wx-token',
    wechatEncodingAESKey: 'b'.repeat(43), wechatAllowedOpenIds: 'wx_user',
    feishuAppId: 'cli_app', feishuAppSecret: 'private-feishu-secret',
    feishuVerificationToken: 'private-feishu-token', feishuEncryptKey: 'private-feishu-key',
    feishuAllowedOpenIds: 'ou_user'};
  const load = t.mock.method(SayService.prototype, 'settings', async() => ({...settings}));
  plugin.register({logger: {info: noop}, widgets: {Widget: class {}, register: noop},
    templates: {registerFunction: noop}, routes: {register: noop}, admin: {
      registerPanel: noop, registerPage: page => pages.push(page),
      registerForm: form => forms.push(form), registerAction: noop
    }});
  return {forms: forms.filter(form => form.page === 'settings'), pages, settings, load};
}

test('references one registered settings resource, not a separate Feishu endpoint', async t => {
  const {forms, pages, load} = setup(t);
  assert.deepEqual(forms.map(form => form.id), ['say-basic-settings']);
  const page = await pages.find(page => page.id === 'settings').load();
  assert.equal(load.mock.callCount(), 0);
  assert.deepEqual(page.sections.filter(section => section.type === 'form').map(section => section.id),
    ['say-basic-settings']);
  assert.ok(!page.sections.some(section => section.type === 'tabs'));
  await forms[0].load();
  assert.equal(load.mock.callCount(), 1);
});

test('loads all existing settings once and reads fresh values on a new load', async t => {
  const {forms: [form], settings, load} = setup(t);
  assert.deepEqual(await form.load(), settings);
  assert.equal(load.mock.callCount(), 1);
  settings.feishuAppId = 'cli_updated';
  assert.equal((await form.load()).feishuAppId, 'cli_updated');
  assert.equal(load.mock.callCount(), 2);
});

test('shows all publishing methods together without an exclusive selector or conditional fields', t => {
  const {forms: [form], settings} = setup(t);
  assert.deepEqual(form.fields.map(field => field.name).sort(), Object.keys(settings).sort());
  assert.equal(new Set(form.fields.map(field => field.name)).size, form.fields.length);
  assert.ok(form.fields.every(field => !field.visibleWhen && field.type !== 'radio'));
  assert.equal(form.submitLabel, '保存全部设置');
});

test('submits multiple publishing methods together in one save', async t => {
  const {forms: [form]} = setup(t);
  const writes = [];
  t.mock.method(SayService.prototype, 'saveSettings', async values => writes.push(values));
  const input = {enabled: true, pageSize: 30, authorId: 2, apiKey: 'api-key-1234567890',
    wecomCorpId: 'corp_changed', wechatAppId: 'wx_changed', feishuAppId: 'cli_changed'};
  assert.match((await form.submit(input)).message, /全部设置已保存/);
  assert.deepEqual(writes, [input]);
});

test('saves all providers concurrently and preserves existing partial-save behavior', async t => {
  const {forms: [form], settings} = setup(t);
  let stored = {...settings};
  t.mock.method(SayService.prototype, 'settings', async() => ({...stored}));
  const previousThink = global.think;
  t.after(() => {
    if (previousThink === undefined) delete global.think;
    else global.think = previousThink;
  });
  global.think = {model: () => ({
    updateOptions: async(key, value) => {
      assert.equal(key, 'plugin_say_settings');
      stored = JSON.parse(value);
    }
  })};
  const allValues = {...await form.load(), apiKey: 'all-api-key-1234567890',
    wecomCorpId: 'corp_all', wechatAppId: 'wx_all', feishuAppId: 'cli_all'};
  await form.submit(allValues);
  assert.deepEqual(stored, allValues);
  assert.deepEqual(await form.load(), allValues);

  const changes = {external: {apiKey: 'new-api-key-at-least-16'},
    wecom: {wecomCorpId: 'corp_updated', wecomCorpSecret: ''},
    wechat: {wechatAppId: '', wechatAllowedOpenIds: ''},
    feishu: {feishuAppId: 'cli_updated', feishuAllowedOpenIds: ''}};
  for (const values of Object.values(changes)) {
    const before = {...stored};
    await form.submit({...values, pageSize: 30});
    for (const name of Object.keys(before)) {
      if (name === 'pageSize') assert.equal(stored[name], 30);
      else if (name === 'wecomCorpSecret') assert.equal(stored[name], before[name]);
      else assert.equal(stored[name], Object.hasOwn(values, name) ? values[name] : before[name]);
    }
    assert.ok(!Object.hasOwn(stored, 'settingsGroup'));
    const reloaded = await form.load();
    assert.equal(reloaded.pageSize, 30);
    assert.ok(!Object.hasOwn(reloaded, 'settingsGroup'));
  }
});
