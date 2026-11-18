'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const plugin = require('../plugin');
const {SayService} = require('../lib/say-service');
const feishuReply = require('../lib/feishu-reply');
const {signature} = require('../lib/feishu');

const settings = {enabled: true, feishuAppId: 'test-app', feishuEncryptKey: 'test-key',
  feishuVerificationToken: 'test-token', feishuAllowedOpenIds: 'ou_allowed', authorId: 1};

function encrypt(payload) {
  const key = crypto.createHash('sha256').update(settings.feishuEncryptKey).digest();
  const iv = Buffer.alloc(16, 7);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return {encrypt: Buffer.concat([iv, cipher.update(JSON.stringify(payload)), cipher.final()]).toString('base64')};
}

function setup(t, overrides = {}) {
  const published = [];
  const replies = [];
  const errors = [];
  t.mock.method(feishuReply, 'reply', async(...args) => { replies.push(args) });
  t.mock.method(SayService.prototype, 'settings', async() => ({...settings, ...overrides}));
  t.mock.method(SayService.prototype, 'create', async item => { published.push(item); return {...item, id: 42} });
  const routes = [];
  const noop = () => {};
  plugin.register({logger: {info: noop, error: text => errors.push(text)}, widgets: {Widget: class {}, register: noop},
    templates: {registerFunction: noop}, routes: {register: route => routes.push(route)},
    admin: {registerPanel: noop, registerPage: noop, registerForm: noop, registerAction: noop}});
  const route = routes.find(route => route.path === '/feishu');
  assert.equal(route.method, 'POST');
  return {published, replies, errors, request: (body, {signed = false, timestamp = String(Math.floor(Date.now() / 1000)),
    signatureValue, rawBody = JSON.stringify(body)} = {}) => {
    const headers = signed ? {'X-Lark-Request-Timestamp': timestamp, 'X-Lark-Request-Nonce': 'nonce',
      'X-Lark-Signature': signatureValue ?? signature(timestamp, 'nonce', settings.feishuEncryptKey, rawBody)} : {};
    return route.handler({body, ctx: {request: {rawBody}, get: name => headers[name] || '',
      throw: (status, message) => { throw Object.assign(new Error(message), {status}) }}});
  }};
}

for (const encrypted of [false, true]) {
  const label = encrypted ? 'encrypted' : 'plaintext';
  const envelope = payload => encrypted ? encrypt(payload) : payload;
  test(`returns the top-level ${label} URL challenge without event signature headers`, async t => {
    const {request, published} = setup(t);
    const payload = {type: 'url_verification', token: settings.feishuVerificationToken, challenge: 'test-challenge'};
    assert.deepEqual(await request(envelope(payload)), {challenge: 'test-challenge'});
    assert.deepEqual(published, []);
  });
  test(`rejects ${label} URL verification with invalid tokens or challenges`, async t => {
    const {request, published} = setup(t);
    const payload = {type: 'url_verification', token: settings.feishuVerificationToken, challenge: 'test-challenge'};
    for (const token of ['', 'wrong-token', undefined]) {
      await assert.rejects(request(envelope({...payload, token})), {status: 401});
    }
    for (const challenge of ['', 123, {}, undefined]) {
      await assert.rejects(request(envelope({...payload, challenge})), {status: 400});
    }
    assert.deepEqual(published, []);
  });
}

function message(eventId, openId = 'ou_allowed') {
  return {schema: '2.0', header: {event_id: eventId, event_type: 'im.message.receive_v1',
    app_id: settings.feishuAppId, token: settings.feishuVerificationToken},
  event: {sender: {sender_id: {open_id: openId}}, message: {message_id: 'om_message', message_type: 'text',
    content: JSON.stringify({text: 'hello'})}}};
}

test('ordinary events still require fresh valid signatures, token, app ID and publisher allowlist', async t => {
  const {request, published} = setup(t);
  const payload = message('security-check');
  await assert.rejects(request(encrypt(payload)), {status: 401, message: 'Invalid Feishu signature'});
  await assert.rejects(request(encrypt(payload), {signed: true, signatureValue: 'wrong'}), {status: 401});
  await assert.rejects(request(encrypt(payload), {signed: true,
    timestamp: String(Math.floor(Date.now() / 1000) - 600)}), {status: 401});
  for (const header of [{...payload.header, token: 'wrong'}, {...payload.header, app_id: 'wrong'}]) {
    await assert.rejects(request(encrypt({...payload, header}), {signed: true}), {status: 401});
  }
  assert.deepEqual(await request(encrypt(message('not-allowed', 'ou_other')), {signed: true}), {});
  assert.deepEqual(published, []);
  // Preserve the exact raw bytes when verifying signatures, including whitespace.
  const body = encrypt(payload);
  assert.deepEqual(await request(body, {signed: true, rawBody: JSON.stringify(body, null, 2)}), {});
  assert.equal(published.length, 1);
  assert.equal(published[0].text, 'hello');
  await request(body, {signed: true});
  assert.equal(published.length, 1, 'duplicate events must not publish again');
});

test('a challenge field alone cannot bypass ordinary event authentication', async t => {
  const {request, published} = setup(t);
  await assert.rejects(request({challenge: 'test-challenge', token: settings.feishuVerificationToken}), {status: 401});
  const payload = {...message('event-with-challenge'), challenge: 'not-url-verification'};
  await assert.rejects(request(encrypt(payload)), {status: 401});
  assert.deepEqual(await request(encrypt(payload), {signed: true}), {});
  assert.equal(published.length, 1);
});

test('invalid encrypted and JSON payloads fail closed without publishing', async t => {
  const {request, published} = setup(t);
  for (const body of [{encrypt: 'invalid'}, '{', 'null', [], '123']) {
    await assert.rejects(request(body, {rawBody: typeof body === 'string' ? body : JSON.stringify(body)}),
      {status: 400});
  }
  assert.deepEqual(published, []);
});

test('disabled publishing still rejects URL verification', async t => {
  const {request} = setup(t, {enabled: false});
  await assert.rejects(request({type: 'url_verification', token: settings.feishuVerificationToken,
    challenge: 'test-challenge'}), {status: 503});
});


test('replies only after successful storage and ignores authenticated duplicates', async t => {
  const {request, replies} = setup(t);
  let release;
  const stored = new Promise(resolve => { release = resolve });
  const create = t.mock.method(SayService.prototype, 'create', () => stored);
  const body = encrypt(message('reply-after-save'));
  const first = request(body, {signed: true});
  const second = request(body, {signed: true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(create.mock.callCount(), 1);
  assert.equal(replies.length, 0);
  release({id: 73});
  await Promise.all([first, second]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0][0], 'om_message');
  assert.match(replies[0][1], /发布成功.*#73/);
  await request(body, {signed: true});
  assert.equal(create.mock.callCount(), 1);
  assert.equal(replies.length, 1);
});

test('a reply failure is acknowledged; retry only retries the reply, never publishing', async t => {
  const {request, published, errors} = setup(t);
  let calls = 0;
  t.mock.method(feishuReply, 'reply', async() => {
    if (++calls === 1) throw Object.assign(new Error('secret-remote-message'), {feishuCode: 230035});
  });
  const body = encrypt(message('reply-failure'));
  assert.deepEqual(await request(body, {signed: true}), {});
  assert.equal(published.length, 1);
  assert.match(errors[0], /230035/);
  assert.doesNotMatch(errors[0], /secret-remote-message/);
  await request(body, {signed: true});
  assert.equal(published.length, 1);
  assert.equal(calls, 2);
});

test('storage errors send safe diagnostic feedback, not arbitrary exception details', async t => {
  const {request, replies, errors} = setup(t);
  const create = t.mock.method(SayService.prototype, 'create', async() => {
    throw new Error('postgres://user:secret@private-host/db INSERT ... app-secret verification-token');
  });
  const body = encrypt(message('storage-failure'));
  assert.deepEqual(await request(body, {signed: true}), {});
  assert.equal(replies.length, 1);
  assert.match(replies[0][1], /保存碎语失败/);
  assert.match(replies[0][1], /参考编号：[a-f0-9]{16}/);
  assert.doesNotMatch(JSON.stringify([replies, errors]), /postgres:|private-host|INSERT|app-secret|verification-token/);
  await request(body, {signed: true});
  assert.equal(create.mock.callCount(), 1);
  assert.equal(replies.length, 1);
});

test('media API failures identify the failed step without echoing the provider response', async t => {
  const {request, replies, published} = setup(t);
  const payload = message('invalid-media');
  payload.event.message.message_type = 'image';
  payload.event.message.content = JSON.stringify({image_key: 'invalid/key'});
  await request(encrypt(payload), {signed: true});
  assert.match(replies[0][1], /下载飞书附件失败.*附件标识无效/);
  assert.equal(published.length, 0);
});

test('only authenticated allowlisted messages can trigger replies, never URL verification', async t => {
  const {request, replies} = setup(t);
  await assert.rejects(request(encrypt(message('unsigned-feedback'))), {status: 401});
  await request(encrypt(message('unauthorized-feedback', 'ou_other')), {signed: true});
  await request({type: 'url_verification', token: settings.feishuVerificationToken, challenge: 'verify'});
  assert.equal(replies.length, 0);
});

test('merge completion and help receive appropriate feedback instead of a false publish success', async t => {
  const {request, replies, published} = setup(t);
  const merge = t.mock.method(SayService.prototype, 'merge', async() => ({id: 8}));
  const payload = message('merge-feedback');
  payload.event.message.content = JSON.stringify({text: '/merge 1,2'});
  await request(encrypt(payload), {signed: true});
  assert.match(replies[0][1], /已合并.*#8/);
  assert.equal(merge.mock.callCount(), 1);
  const help = message('help-feedback');
  help.event.message.content = JSON.stringify({text: '/help'});
  await request(encrypt(help), {signed: true});
  assert.match(replies[1][1], /发送文本/);
  assert.equal(published.length, 0);
});


test('a real media API error sends safe feedback and never starts storage', async t => {
  const {request, replies, published} = setup(t);
  t.mock.method(global, 'fetch', async() => ({ok: false, status: 403,
    json: async() => ({code: 10003, msg: 'app-secret db-password private-response'})}));
  const payload = message('media-api-error');
  payload.event.message.message_type = 'image';
  payload.event.message.content = JSON.stringify({image_key: 'img_valid'});
  await request(encrypt(payload), {signed: true});
  assert.match(replies[0][1], /下载飞书附件失败.*App ID 和 App Secret/);
  assert.match(replies[0][1], /飞书错误码 10003/);
  assert.doesNotMatch(replies[0][1], /app-secret|db-password|private-response/);
  assert.equal(published.length, 0);
});
