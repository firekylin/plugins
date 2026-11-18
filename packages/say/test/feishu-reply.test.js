'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {diagnostic, reply, step} = require('../lib/feishu-reply');

function settings(id) {
  return {feishuAppId: `reply-test-${id}`, feishuAppSecret: 'test-secret'};
}
function response(result, ok = true) {
  return {ok, status: ok ? 200 : 403, json: async() => result};
}

test('uses the reply API with a cached tenant token, JSON content and stable bounded uuid', async() => {
  const calls = [];
  const fetchImpl = async(url, options) => {
    calls.push({url, options});
    return response(url.includes('/auth/') ? {code: 0, tenant_access_token: 'test-access-token', expire: 7200}
      : {code: 0, data: {message_id: 'om_reply'}});
  };
  const config = settings('success');
  await reply('om_original', '✅ 发布成功，碎语 #1。', 'event-1', config, fetchImpl);
  await reply('om_original', '✅ 发布成功，碎语 #1。', 'event-1', config, fetchImpl);
  assert.equal(calls.length, 3, 'second request reuses the token');
  assert.equal(calls[1].url, 'https://open.feishu.cn/open-apis/im/v1/messages/om_original/reply');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-access-token');
  assert.equal(calls[1].options.redirect, 'error');
  assert.ok(calls[1].options.signal instanceof AbortSignal);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.msg_type, 'text');
  assert.deepEqual(JSON.parse(body.content), {text: '✅ 发布成功，碎语 #1。'});
  assert.match(body.uuid, /^[a-f0-9]{40}$/);
  assert.equal(body.uuid, JSON.parse(calls[2].options.body).uuid);
  assert.doesNotMatch(calls[1].options.body, /test-secret|test-access-token/);
});

test('reply failures expose a numeric API code, never an untrusted error body', async() => {
  const fetchImpl = async url => response(url.includes('/auth/')
    ? {code: 0, tenant_access_token: 'test-token'}
    : {code: 230035, msg: 'secret-value https://internal.example/private'}, !url.includes('/reply'));
  await assert.rejects(reply('om_original', 'feedback', 'event-2', settings('denied'), fetchImpl), error => {
    assert.equal(error.feishuCode, 230035);
    assert.match(diagnostic(error, 'reply'), /230035/);
    assert.doesNotMatch(diagnostic(error, 'reply'), /secret-value|internal\.example/);
    return true;
  });
});

test('missing credentials and invalid message IDs do not make any network requests', async() => {
  const noFetch = async() => { assert.fail('unexpected network call') };
  await assert.rejects(reply('../unexpected', 'feedback', 'event', settings('bad-id'), noFetch));
  await assert.rejects(reply('om_original', 'feedback', 'event', {feishuAppId: 'app'}, noFetch),
    /App Secret is not configured/);
});

test('safe error descriptions distinguish operation, timeout and configuration errors', async() => {
  for (const [stage, cause, expected] of [
    ['download', new Error('Feishu resource error: private token'), /下载飞书附件失败.*读取权限/],
    ['upload', Object.assign(new Error('secret endpoint'), {name: 'TimeoutError'}), /上传附件超时/],
    ['merge', new Error('At least two say IDs are required'), /至少两个碎语 ID/],
    ['save', new Error('db password=secret'), /保存碎语失败.*后台日志/],
    ['save', Object.assign(new Error('db password=secret'), {code: '28P01'}), /28P01.*数据库认证失败/]
  ]) {
    await assert.rejects(step(stage, async() => { throw cause }), error => {
      assert.match(diagnostic(error), expected);
      assert.doesNotMatch(diagnostic(error), /private token|secret endpoint|password=secret/);
      return true;
    });
  }
  assert.match(diagnostic(new Error('Feishu token error: private token'), 'reply'), /App ID 和 App Secret/);
});
