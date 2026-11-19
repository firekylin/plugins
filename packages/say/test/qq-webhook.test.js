'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createQqWebhook, privateKey, verify} = require('../lib/qq-webhook');
const now = () => 1800000000000;
const secret = 'test-secret';
function fixture() {
  const rows = new Map(), writes = [], replies = [], uploads = [], logs = [];
  const logger = {info: line => logs.push(line), error: () => {}};
  const settings = {enabled: true, qqEnabled: true, qqAppId: 'app', qqAppSecret: secret, qqSandbox: false, qqAllowedOpenIds: 'USER', authorId: 7};
  let fail = false;
  const getModel = () => ({add: async row => {
    if (fail) throw new Error('private database details');
    if (rows.has(row.key)) throw Object.assign(new Error('duplicate'), {code: '23505'});
    rows.set(row.key, row); return row.key;
  }, where: where => ({find: async() => rows.get(where.key) || {}})});
  const service = {settings: async() => ({...settings}), create: async(input, author) => {writes.push({input, author}); return {id: 1}},
    merge: async ids => {writes.push({ids}); return {id: 2}}};
  const api = {reply: async(...args) => {replies.push(args)}, download: async() => ({buffer: Buffer.from('x')})};
  const factory = () => createQqWebhook({service, getModel, now, logger, mediaClient: {uploadBuffer: async() => {uploads.push(1); return 'https://media.test/a'}},
    apiFactory: () => api});
  const event = {op: 0, t: 'C2C_MESSAGE_CREATE', d: {id: 'MESSAGE', author: {user_openid: 'USER'}, content: 'hello'}};
  function request(payload = event, signed = true) {
    const raw = JSON.stringify(payload);
    const headers = {'X-Bot-Appid': 'app', 'X-Signature-Timestamp': String(now() / 1000)};
    if (signed) headers['X-Signature-Ed25519'] = crypto.sign(null, Buffer.from(headers['X-Signature-Timestamp'] + raw), privateKey(secret)).toString('hex');
    const ctx = {request: {rawBody: raw}, get: name => headers[name] || '', set() {}, throw(status) {throw Object.assign(new Error('rejected'), {status})}};
    return {ctx, headers};
  }
  return {logs, logger, api, factory, request, event, rows, writes, replies, settings, uploads, service, fail: () => {fail = true}};
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


const codes = f => f.logs.map(line => line.split(' ').at(-1));
test('logs challenge and whoami success with per-request correlation and no payload data', async() => {
  const f = fixture();
  await f.factory()(f.request({op: 13, d: {plain_token: 'SensitiveChallenge', event_ts: String(now() / 1000)}}, false));
  assert.deepEqual(codes(f), ['RECEIVED', 'CHALLENGE_RECEIVED', 'CHALLENGE_ACCEPTED']);
  const challengeId = f.logs[0].split(' ')[2];
  f.logs.length = 0;
  f.event.d.content = '/whoami';
  await f.factory()(f.request());
  assert.deepEqual(codes(f), ['RECEIVED', 'SIGNATURE_ACCEPTED', 'EVENT_C2C_MESSAGE_CREATE', 'CLAIM_ACQUIRED',
    'WHOAMI', 'COMMAND_RESPONSE_READY', 'REPLY_STARTED', 'REPLY_SUCCEEDED', 'ACK']);
  assert.equal(new Set(f.logs.map(line => line.split(' ')[2])).size, 1);
  assert.notEqual(f.logs[0].split(' ')[2], challengeId);
  for (const line of f.logs) assert.match(line, /^say: QQ_DIAG [a-f0-9-]{36} [A-Z0-9_]+$/);
  assert.doesNotMatch(f.logs.join('\n'), /test-secret|SensitiveChallenge|USER|hello|https:/);
});
test('logs safe rejection and ignored-event reasons without echoing attacker values', async() => {
  const cases = [
    [f => {f.settings.qqEnabled = false}, () => {}, 'DISABLED_OR_UNCONFIGURED'],
    [() => {}, r => {r.headers['X-Bot-Appid'] = 'secret-injected'}, 'APP_ID_MISMATCH'],
    [() => {}, r => {delete r.ctx.request.rawBody}, 'RAW_BODY_MISSING'],
    [() => {}, r => {r.headers['X-Signature-Timestamp'] = '0'}, 'TIMESTAMP_INVALID'],
    [() => {}, r => {r.headers['X-Signature-Ed25519'] = 'secret-injected'}, 'SIGNATURE_INVALID'],
    [f => {f.event.t = 'secret-injected\nFAKE_LOG'}, () => {}, 'IGNORED_EVENT_TYPE'],
    [f => {f.settings.qqAllowedOpenIds = ''}, () => {}, 'IGNORED_NOT_ALLOWLISTED'],
    [f => {delete f.event.d.author}, () => {}, 'IGNORED_MESSAGE_SHAPE']
  ];
  for (const [setup, change, expected] of cases) {
    const f = fixture(); setup(f); const r = f.request(); change(r);
    try { await f.factory()(r) } catch (error) { assert.ok([400, 403].includes(error.status)) }
    assert.ok(codes(f).includes(expected), expected);
    for (const line of f.logs) assert.match(line, /^say: QQ_DIAG [a-f0-9-]{36} [A-Z0-9_]+$/);
  }
});
test('distinguishes durable duplicates, save failure and reply failure', async() => {
  const f = fixture();
  f.api.reply = async() => {throw new Error('secret reply body')};
  await f.factory()(f.request());
  assert.ok(codes(f).includes('PUBLISH_SUCCEEDED'));
  assert.ok(codes(f).includes('REPLY_FAILED'));
  f.logs.length = 0;
  await f.factory()(f.request());
  assert.deepEqual(codes(f), ['RECEIVED', 'SIGNATURE_ACCEPTED', 'EVENT_C2C_MESSAGE_CREATE', 'DUPLICATE_CLAIMED', 'ACK']);
  const failed = fixture();
  failed.service.create = async() => {throw new Error('secret database body')};
  await failed.factory()(failed.request());
  assert.ok(codes(failed).includes('PUBLISH_FAILED'));
  assert.doesNotMatch([...f.logs, ...failed.logs].join(' '), /secret|database/);
});
test('entry is logged before settings failure; logging failure cannot fail a successful callback', async() => {
  const f = fixture();
  f.service.settings = async() => {throw new Error('secret')};
  await assert.rejects(f.factory()(f.request()));
  assert.deepEqual(codes(f), ['RECEIVED', 'SETTINGS_FAILED']);
  const other = fixture();
  other.logger.info = () => {throw new Error('logger unavailable')};
  assert.deepEqual(await other.factory()(other.request()), {op: 12});
  assert.equal(other.writes.length, 1);
});
