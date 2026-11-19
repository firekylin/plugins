'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createQqWebhook, privateKey, verify} = require('../lib/qq-webhook');
const now = () => 1800000000000;
const secret = 'test-secret';
function fixture() {
  const rows = new Map(), writes = [], replies = [], uploads = [];
  const settings = {enabled: true, qqEnabled: true, qqAppId: 'app', qqAppSecret: secret, qqSandbox: false, qqAllowedOpenIds: 'USER', authorId: 7};
  let fail = false;
  const getModel = () => ({add: async row => {
    if (fail) throw new Error('private database details');
    if (rows.has(row.key)) throw Object.assign(new Error('duplicate'), {code: '23505'});
    rows.set(row.key, row); return row.key;
  }, where: where => ({find: async() => rows.get(where.key) || {}})});
  const service = {settings: async() => ({...settings}), create: async(input, author) => {writes.push({input, author}); return {id: 1}},
    merge: async ids => {writes.push({ids}); return {id: 2}}};
  const factory = () => createQqWebhook({service, getModel, now, mediaClient: {uploadBuffer: async() => {uploads.push(1); return 'https://media.test/a'}},
    apiFactory: () => ({reply: async(...args) => {replies.push(args)}, download: async() => ({buffer: Buffer.from('x')})})});
  const event = {op: 0, t: 'C2C_MESSAGE_CREATE', d: {id: 'MESSAGE', author: {user_openid: 'USER'}, content: 'hello'}};
  function request(payload = event, signed = true) {
    const raw = JSON.stringify(payload);
    const headers = {'X-Bot-Appid': 'app', 'X-Signature-Timestamp': String(now() / 1000)};
    if (signed) headers['X-Signature-Ed25519'] = crypto.sign(null, Buffer.from(headers['X-Signature-Timestamp'] + raw), privateKey(secret)).toString('hex');
    const ctx = {request: {rawBody: raw}, get: name => headers[name] || '', set() {}, throw(status) {throw Object.assign(new Error('rejected'), {status})}};
    return {ctx, headers};
  }
  return {factory, request, event, rows, writes, replies, settings, uploads, service, fail: () => {fail = true}};
}
test('verifies official Ed25519 sample and rejects tampered payload', () => {
  const raw = Buffer.from('Arq0D5A61EgUu4OxUvOp');
  const signature = '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706';
  assert.equal(verify(raw, '1725442341', signature, 'DG5g3B4j9X2KOErG', () => 1725442341000), true);
  assert.equal(verify(Buffer.from('{}'), '1725442341', signature, 'DG5g3B4j9X2KOErG', () => 1725442341000), false);
});
test('answers unsigned setup challenge without publishing; rejects arbitrary signing and stale challenges', async() => {
  const f = fixture(), handler = f.factory();
  const event = {op: 13, d: {plain_token: 'token123', event_ts: String(now() / 1000)}};
  const result = await handler(f.request(event, false));
  assert.equal(result.plain_token, 'token123');
  assert.ok(crypto.verify(null, Buffer.from(event.d.event_ts + 'token123'), crypto.createPublicKey(privateKey(secret)), Buffer.from(result.signature, 'hex')));
  for (const d of [{plain_token: '{}', event_ts: event.d.event_ts}, {plain_token: 'token', event_ts: '1000000000'}]) {
    await assert.rejects(handler(f.request({op: 13, d}, false)), {status: 400});
  }
  assert.equal(f.rows.size, 0);
});
test('two webhook instances share durable claims, including restart replay', async() => {
  const f = fixture();
  await Promise.all([f.factory()(f.request()), f.factory()(f.request())]);
  await f.factory()(f.request());
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].author, 7);
  assert.equal(f.rows.size, 1);
  assert.doesNotMatch(JSON.stringify([...f.rows]), /USER|MESSAGE|hello|test-secret/);
});
test('rejects missing raw body, forged signatures, stale timestamps and wrong app', async() => {
  for (const change of [r => {delete r.ctx.request.rawBody}, r => {r.ctx.request.rawBody += ' '},
    r => {r.headers['X-Signature-Timestamp'] = '1000000000'}, r => {r.headers['X-Bot-Appid'] = 'other'},
    r => {r.headers['X-Signature-Ed25519'] = '0'.repeat(128)}]) {
    const f = fixture(), r = f.request(); change(r);
    await assert.rejects(f.factory()(r));
    assert.equal(f.rows.size, 0);
    assert.equal(f.writes.length, 0);
  }
});
test('checks allowlist, supports whoami, ignores other events, and disables callbacks', async() => {
  const f = fixture();
  f.settings.qqAllowedOpenIds = '';
  await f.factory()(f.request());
  assert.equal(f.rows.size, 0);
  f.event.d.content = '/whoami';
  await f.factory()(f.request());
  assert.match(f.replies[0][2], /USER/);
  assert.equal(f.writes.length, 0);
  await f.factory()(f.request({...f.event, t: 'GROUP_AT_MESSAGE_CREATE'}));
  f.settings.qqEnabled = false;
  await assert.rejects(f.factory()(f.request()), {status: 403});
});
test('database claim failure prevents side effects and returns retryable 503', async() => {
  const f = fixture(); f.fail();
  await assert.rejects(f.factory()(f.request()), {status: 503});
  assert.equal(f.writes.length, 0);
  assert.equal(f.uploads.length, 0);
});
test('Webhook routes retain image and voice handling with no startup sockets', async() => {
  for (const content_type of ['image/png', 'audio/ogg']) {
    const f = fixture();
    f.event.d.attachments = [{content_type, url: 'https://nt.qq.com/a'}];
    await f.factory()(f.request());
    await f.factory()(f.request());
    assert.equal(f.uploads.length, 1);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].input.kind, content_type.startsWith('image') ? 'textpic' : 'voice');
  }
  const routes = [], noop = () => {};
  const plugin = require('../plugin');
  plugin.register({widgets: {Widget: class {}, register: noop}, templates: {registerFunction: noop},
    routes: {register: route => routes.push(route)}, admin: {registerPanel: noop, registerPage: noop, registerForm: noop, registerAction: noop}});
  assert.equal(plugin.activate, undefined);
  assert.ok(routes.some(route => route.path === '/qq' && route.method === 'POST' && route.csrf === false));
});

test('real SQLite unique receipt constraint survives separate store instances', async() => {
  const {DatabaseSync} = require('node:sqlite');
  const {receiptStore} = require('../lib/qq-webhook');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE options (key TEXT PRIMARY KEY, value TEXT)');
    const getModel = () => ({add: async row => db.prepare('INSERT INTO options (key,value) VALUES (?,?)').run(row.key, row.value),
      where: where => ({find: async() => db.prepare('SELECT * FROM options WHERE key=?').get(where.key)})});
    const [a, b] = await Promise.all([receiptStore(getModel)('same'), receiptStore(getModel)('same')]);
    assert.deepEqual([a, b], [true, false]);
    assert.equal(await receiptStore(getModel)('same'), false);
    assert.equal(await receiptStore(getModel)('different'), true);
  } finally { db.close() }
});


test('uncertain save failure is terminal across instances and cannot repeat uploaded media', async() => {
  const f = fixture();
  let saves = 0;
  f.service.create = async() => { saves++; throw new Error('private database details') };
  f.event.d.attachments = [{content_type: 'image/png', url: 'https://nt.qq.com/a'}];
  await f.factory()(f.request());
  await f.factory()(f.request());
  assert.equal(f.uploads.length, 1);
  assert.equal(saves, 1);
  assert.equal(f.rows.size, 1);
  assert.doesNotMatch(JSON.stringify(f.replies), /private database details/);
});

test('uses signed raw bytes rather than an independently supplied parsed body', async() => {
  const f = fixture();
  await f.factory()({...f.request(), body: {...f.event, d: {...f.event.d, content: 'forged'}}});
  assert.equal(f.writes[0].input.text, 'hello');
});
