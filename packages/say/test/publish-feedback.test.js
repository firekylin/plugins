'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const plugin = require('../plugin');
const {SayService} = require('../lib/say-service');
const feedback = require('../lib/publish-feedback');
const {encrypt, decrypt, signature, xmlValue} = require('../lib/wecom');

function setup(t) {
  const key = Buffer.alloc(32, 4).toString('base64').replace(/=$/, '');
  const settings = {enabled: true, authorId: 1, apiKey: 'valid-key',
    wecomCorpId: 'corp', wecomToken: 'token', wecomEncodingAESKey: key,
    wechatAppId: 'corp', wechatToken: 'token', wechatEncodingAESKey: key,
    wechatAllowedOpenIds: 'publisher'};
  t.mock.method(SayService.prototype, 'settings', async() => settings);
  const create = t.mock.method(SayService.prototype, 'create', async() => ({id: 42, text: 'hello'}));
  const routes = [];
  const noop = () => {};
  plugin.register({logger: {info: noop, error: noop}, widgets: {Widget: class {}, register: noop},
    templates: {registerFunction: noop}, routes: {register: route => routes.push(route)},
    admin: {registerPanel: noop, registerPage: noop, registerForm: noop, registerAction: noop}});
  return {create, async call(channel, content = 'hello', {sender = 'publisher', invalidSignature = false} = {}) {
    const ctx = {method: 'POST', request: {}, set: noop, get: () => 'valid-key',
      throw(status, message) {
        throw Object.assign(new Error(message), {status});
      }};
    const route = routes.find(route => route.path === `/${channel}` && route.method !== 'OPTIONS');
    if (channel === 'publish') return {result: await route.handler({ctx, body: {text: content}}), ctx};
    const xml = `<xml><ToUserName>corp</ToUserName><FromUserName>${sender}</FromUserName><MsgType>text</MsgType><Content>${content}</Content><MsgId>1</MsgId></xml>`;
    const encrypted = encrypt(xml, key, 'corp');
    const body = `<xml><Encrypt>${encrypted}</Encrypt></xml>`;
    ctx.request.rawBody = body;
    const result = await route.handler({ctx, body, query: {timestamp: '1', nonce: 'nonce',
      msg_signature: invalidSignature ? 'invalid' : signature('token', '1', 'nonce', encrypted)}});
    return {result: xmlValue(decrypt(xmlValue(result, 'Encrypt'), key, 'corp'), 'Content'), ctx};
  }};
}

for (const channel of ['wecom', 'wechat', 'publish']) {
  test(`${channel} returns the shared success and safe failure feedback`, async t => {
    const {create, call} = setup(t);
    const {result} = await call(channel);
    assert.equal(channel === 'publish' ? result.message : result, feedback.success({id: 42}));
    if (channel === 'publish') {
      assert.equal(result.id, 42);
      assert.equal(result.text, 'hello');
      assert.equal(result.success, true);
    }
    create.mock.mockImplementation(async() => {
      throw new Error('password=secret SQL private-host');
    });
    const failed = await call(channel);
    const message = channel === 'publish' ? failed.result.message : failed.result;
    assert.match(message, /保存碎语失败/);
    assert.match(message, /参考编号：[a-f0-9]{16}/);
    assert.doesNotMatch(message, /password|SQL|private-host/);
    if (channel === 'publish') {
      assert.equal(failed.ctx.status, 500);
      assert.equal(failed.result.success, false);
    }
  });
}


test('admin publishing uses the shared result and sanitizes errors', async() => {
  const result = await feedback.adminResult(async() => ({id: 42}), 'publish');
  assert.equal(result.message, feedback.success({id: 42}));
  await assert.rejects(feedback.adminResult(async() => {
    throw Object.assign(new Error('private SQL password'), {status: 400});
  }, 'merge'), error => {
    assert.equal(error.status, 400);
    assert.match(error.message, /合并碎语失败/);
    assert.doesNotMatch(error.message, /private|SQL|password/);
    return true;
  });
});

for (const channel of ['wecom', 'wechat']) {
  test(`${channel} whoami returns authenticated sender identity without publishing or allowlisting`, async t => {
    const {create, call} = setup(t);
    const merge = t.mock.method(SayService.prototype, 'merge', async() => { throw new Error('must not merge') });
    const result = await call(channel, ' /whoami ', {sender: 'not_allowlisted'});
    assert.match(result.result, /not_allowlisted/);
    assert.match(result.result, channel === 'wecom' ? /企业微信 UserID/ : /微信公众号 OpenID/);
    assert.equal(create.mock.callCount(), 0);
    assert.equal(merge.mock.callCount(), 0);
    await assert.rejects(call(channel, '/whoami', {invalidSignature: true}), {status: 401});
    assert.equal(create.mock.callCount(), 0);
    if (channel === 'wechat') {
      assert.match((await call(channel, 'ordinary text', {sender: 'not_allowlisted'})).result, /没有发布碎语的权限/);
      assert.equal(create.mock.callCount(), 0);
    }
  });
}

test('JSON API treats whoami as content, not a chat identity command', async t => {
  const {create, call} = setup(t);
  await call('publish', '/whoami');
  assert.equal(create.mock.callCount(), 1);
  assert.equal(create.mock.calls[0].arguments[0].text, '/whoami');
});
