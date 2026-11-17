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
    apiKey: 'private-api-key', wecomCorpId: 'corp', wecomCorpSecret: 'private-corp-secret',
    wecomToken: 'private-corp-token', wecomEncodingAESKey: 'private-corp-key',
    wechatAppId: 'wx_app', wechatAppSecret: 'private-wx-secret', wechatToken: 'private-wx-token',
    wechatEncodingAESKey: 'private-wx-key', wechatAllowedOpenIds: 'wx_user',
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
  assert.deepEqual(await form.load(), {...settings, settingsGroup: 'external'});
  assert.equal(load.mock.callCount(), 1);
  settings.feishuAppId = 'cli_updated';
  assert.equal((await form.load()).feishuAppId, 'cli_updated');
  assert.equal(load.mock.callCount(), 2);
});

test('keeps every setting in the unified form and groups all four publishing methods', t => {
  const {forms: [form], settings} = setup(t);
  const selector = form.fields.find(field => field.name === 'settingsGroup');
  assert.equal(selector.type, 'radio');
  assert.deepEqual(selector.options.map(option => option.value), ['external', 'wecom', 'wechat', 'feishu']);
  assert.deepEqual(form.fields.filter(field => field !== selector).map(field => field.name).sort(),
    Object.keys(settings).sort());
  assert.equal(new Set(form.fields.map(field => field.name)).size, form.fields.length);
  for (const group of selector.options.map(option => option.value)) {
    const fields = form.fields.filter(field => field.visibleWhen?.values.includes(group));
    assert.ok(fields.length > 0);
    for (const field of fields) {
      assert.equal(field.visibleWhen.field, selector.name);
      assert.deepEqual(field.visibleWhen.values, [group]);
      assert.ok(group === 'external' ? field.name === 'apiKey' : field.name.startsWith(group));
    }
  }
  assert.ok(form.fields.find(field => field.name === 'enabled').visibleWhen === undefined);
});

test('submits the visible values without persisting the display selector', async t => {
  const {forms: [form]} = setup(t);
  const writes = [];
  t.mock.method(SayService.prototype, 'saveSettings', async values => writes.push(values));
  const input = {settingsGroup: 'feishu', enabled: false, pageSize: 30, authorId: 2,
    amapKey: '', feishuAppId: 'cli_changed', feishuAppSecret: ''};
  assert.match((await form.submit(input)).message, /已保存/);
  const {settingsGroup, ...expected} = input;
  assert.deepEqual(writes[0], expected);
  assert.equal(input.settingsGroup, 'feishu');
});

test('saving each visible group preserves the other providers and supports clearing non-secret fields', async t => {
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
  const changes = {external: {apiKey: 'new-api-key-at-least-16'},
    wecom: {wecomCorpId: 'corp_updated', wecomCorpSecret: ''},
    wechat: {wechatAppId: '', wechatAllowedOpenIds: ''},
    feishu: {feishuAppId: 'cli_updated', feishuAllowedOpenIds: ''}};
  for (const [settingsGroup, values] of Object.entries(changes)) {
    const before = {...stored};
    await form.submit({settingsGroup, ...values, pageSize: 30});
    for (const name of Object.keys(before)) {
      if (name === 'pageSize') assert.equal(stored[name], 30);
      else if (name === 'wecomCorpSecret') assert.equal(stored[name], before[name]);
      else assert.equal(stored[name], Object.hasOwn(values, name) ? values[name] : before[name]);
    }
    assert.ok(!Object.hasOwn(stored, 'settingsGroup'));
    const reloaded = await form.load();
    assert.equal(reloaded.pageSize, 30);
    assert.equal(reloaded.settingsGroup, 'external');
  }
});
