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

test('registers all five settings resources including Feishu and references only registered forms', async t => {
  const {forms, pages} = setup(t);
  assert.equal(forms.length, 5);
  assert.ok(forms.find(form => form.id === 'say-feishu-settings'));
  const refs = [];
  const visit = sections => sections.forEach(section => {
    if (section.type === 'form') refs.push(section.id);
    if (section.type === 'tabs') section.items.forEach(tab => visit(tab.sections));
  });
  visit((await pages.find(page => page.id === 'settings').load()).sections);
  assert.deepEqual(refs.sort(), forms.map(form => form.id).sort());
});

test('shares one read within a page request but reloads fresh values in subsequent requests', async t => {
  const {forms, settings, load} = setup(t);
  const context = {};
  await Promise.all(forms.map(form => form.load(context)));
  assert.equal(load.mock.callCount(), 1);
  settings.feishuAppId = 'cli_updated';
  const feishu = forms.find(form => form.id === 'say-feishu-settings');
  assert.equal((await feishu.load({})).feishuAppId, 'cli_updated');
  assert.equal(load.mock.callCount(), 2);
  await feishu.load();
  await feishu.load();
  assert.equal(load.mock.callCount(), 4);
});

test('keeps independent group submissions', async t => {
  const {forms} = setup(t);
  const writes = [];
  t.mock.method(SayService.prototype, 'saveSettings', async values => writes.push(values));
  for (const form of forms) {
    const input = {[form.fields[0].name]: 'value'};
    assert.match((await form.submit(input)).message, /已保存/);
    assert.deepEqual(writes.at(-1), input);
  }
});
