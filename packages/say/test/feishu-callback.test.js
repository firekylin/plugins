'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const plugin = require('../plugin');
const {SayService} = require('../lib/say-service');
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
  t.mock.method(SayService.prototype, 'settings', async() => ({...settings, ...overrides}));
  t.mock.method(SayService.prototype, 'create', async item => { published.push(item); return item });
  const routes = [];
  const noop = () => {};
  plugin.register({logger: {info: noop}, widgets: {Widget: class {}, register: noop},
    templates: {registerFunction: noop}, routes: {register: route => routes.push(route)},
    admin: {registerPanel: noop, registerPage: noop, registerForm: noop, registerAction: noop}});
  const route = routes.find(route => route.path === '/feishu');
  assert.equal(route.method, 'POST');
  return {published, request: (body, {signed = false, timestamp = String(Math.floor(Date.now() / 1000)),
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
  event: {sender: {sender_id: {open_id: openId}}, message: {message_id: 'message', message_type: 'text',
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

for (const messageType of ['audio', 'image']) {
  test(`signed Feishu ${messageType} event uploads with configured author before publishing`, async t => {
    const {request, published} = setup(t, {authorId: 27});
    const oldThink = global.think;
    const oldFirekylin = global.firekylin;
    t.after(() => { global.think = oldThink; global.firekylin = oldFirekylin; });
    const uploads = [];
    global.think = {model: () => ({getOptions: async() => ({upload: {type: 'r2'}})})};
    global.firekylin = {uploadMedia: async input => {
      uploads.push(input);
      return {url: `/uploads/${messageType}`, id: 88};
    }};
    t.mock.method(global, 'fetch', async value => {
      if (String(value).includes('/auth/')) {
        return {ok: true, json: async() => ({tenant_access_token: 'test', expire: 7200})};
      }
      assert.equal(new URL(value).searchParams.get('type'), messageType === 'audio' ? 'file' : 'image');
      return {ok: true, headers: new Headers({'content-type': messageType === 'audio'
        ? 'application/ogg' : 'image/png'}), arrayBuffer: async() => messageType === 'audio'
        ? Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead')])
        : Buffer.from('89504e470d0a1a0a', 'hex')};
    });
    const payload = message(`registered-${messageType}`);
    payload.event.message = {message_id: `om_${messageType}`, message_type: messageType,
      content: JSON.stringify(messageType === 'audio' ? {file_key: 'file_voice'} : {image_key: 'img_photo'})};
    await request(encrypt(payload), {signed: true});
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].userId, 27);
    assert.equal(uploads[0].file.type, messageType === 'audio' ? 'audio/ogg' : 'image/png');
    assert.equal(published.length, 1);
    assert.equal(published[0].kind, messageType === 'audio' ? 'voice' : 'image');
    await request(encrypt(payload), {signed: true});
    assert.equal(uploads.length, 1, 'completed event replay must not upload twice');
  });
}
