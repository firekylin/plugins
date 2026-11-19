'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createQqPublisher} = require('../lib/qq-publisher');
const {createMediaClient} = require('../lib/media');
const {normalizeSettings} = require('../lib/say-service');

function fixture() {
  const settings = normalizeSettings({qqEnabled: true, qqAppId: '123', qqAppSecret: 'secret',
    qqAllowedOpenIds: 'USER', authorId: 7});
  let active = true;
  let uploadFailure;
  const writes = [], uploads = [], replies = [], logs = [], downloads = [];
  const service = {settings: async() => ({...settings}),
    create: async(input, author) => { writes.push({input, author}); return {id: writes.length} },
    merge: async ids => { writes.push({merge: ids}); return {id: 8} }};
  const mediaClient = createMediaClient({upload: async input => {
    uploads.push(input); if (uploadFailure) throw uploadFailure; return {url: 'https://storage.test/media', id: 10};
  }});
  const api = {reply: async(...args) => replies.push(args), download: async item => {
    downloads.push(item); return {buffer: Buffer.from('ffd8ffe00000', 'hex'), filename: 'qq.jpg', mime: 'image/jpeg'};
  }};
  const receive = createQqPublisher({service, mediaClient, logger: {error: entry => logs.push(entry)}, isActive: () => active});
  const event = (data = {}, extra = {}) => ({t: 'C2C_MESSAGE_CREATE', d: {id: 'MSG', content: 'Hello #QQ',
    author: {user_openid: 'USER'}, ...data}, ...extra});
  return {settings, service, api, writes, uploads, replies, logs, downloads, event,
    failUpload: error => { uploadFailure = error }, stop: () => { active = false }, run: data => receive(data, api, {...settings})};
}

test('QQ settings default off, preserve blank secret and normalize explicit publisher IDs', () => {
  assert.equal(normalizeSettings().qqEnabled, false);
  const settings = normalizeSettings({qqAppSecret: '', qqAllowedOpenIds: 'USER,USER\nOTHER'}, {qqAppSecret: 'keep'});
  assert.equal(settings.qqAppSecret, 'keep');
  assert.equal(settings.qqAllowedOpenIds, 'USER\nOTHER');
  assert.throws(() => normalizeSettings({qqAllowedOpenIds: '*'}), /Invalid QQ/);
});

test('QQ fails closed for non-private/unauthorized/disabled events; whoami does not publish', async() => {
  const f = fixture();
  await f.run(f.event({}, {t: 'GROUP_AT_MESSAGE_CREATE'}));
  await f.run(f.event({author: {user_openid: 'OTHER'}}));
  assert.equal(f.replies.length, 0);
  await f.run(f.event({author: {user_openid: 'OTHER'}, content: '/whoami'}));
  assert.match(f.replies[0][2], /OTHER/);
  assert.equal(f.writes.length, 0);
  f.settings.qqAllowedOpenIds = '';
  await f.run(f.event());
  f.settings.qqEnabled = false;
  await f.run(f.event({content: '/whoami'}));
  assert.equal(f.replies.length, 1);
});

test('QQ publishes text and links with configured owner and replies after storage', async() => {
  const f = fixture();
  f.api.reply = async(...args) => { assert.ok(f.writes.length); f.replies.push(args) };
  await f.run(f.event());
  assert.deepEqual(f.writes[0], {input: {kind: 'text', text: 'Hello #QQ', status: 'public', source: 'QQ'}, author: 7});
  assert.match(f.replies[0][2], /#1/);
  await f.run(f.event({id: 'LINK', content: 'https://example.test/post'}));
  assert.equal(f.writes[1].input.kind, 'link');
  await f.run(f.event({id: 'MERGE', content: '/merge 1,2'}));
  assert.equal(f.writes[2].merge, '1,2');
});

test('QQ image attachment uses the actual host media client and preserves caption/owner', async() => {
  const f = fixture();
  await f.run(f.event({attachments: [{content_type: 'image/jpeg', url: 'https://multimedia.nt.qq.com.cn/a'}]}));
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].ownerId, 7);
  assert.equal(f.writes[0].input.kind, 'textpic');
  assert.deepEqual(f.writes[0].input.images, ['https://storage.test/media']);
});

test('QQ native voice uses validated WAV through host media, rejects raw SILK safely', async() => {
  const f = fixture();
  const wav = Buffer.alloc(46);
  wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(2, 40);
  f.api.download = async() => ({buffer: wav, filename: 'voice.wav', mime: 'audio/wav'});
  await f.run(f.event({content: '', attachments: [{content_type: 'voice'}]}));
  assert.equal(f.uploads[0].mime, 'audio/wav');
  assert.equal(f.writes[0].input.kind, 'voice');
  f.api.download = async() => ({buffer: Buffer.from('#!SILK_V3'), filename: 'voice.silk', mime: 'application/octet-stream'});
  await f.run(f.event({id: 'SILK', content: '', attachments: [{content_type: 'voice'}]}));
  assert.equal(f.writes.length, 1);
  assert.match(f.replies[1][2], /MEDIA_TYPE_MISMATCH/);
  wav.writeUInt32LE(200, 4);
  f.api.download = async() => ({buffer: wav, filename: 'bad.wav', mime: 'audio/wav'});
  await f.run(f.event({id: 'BADWAV', attachments: [{content_type: 'voice'}]}));
  assert.equal(f.uploads.length, 1);
});

test('QQ coalesces concurrent duplicates and retries only a failed result reply', async() => {
  const f = fixture();
  let unblock;
  const barrier = new Promise(resolve => { unblock = resolve });
  f.service.create = async() => { await barrier; f.writes.push({}); return {id: 1} };
  f.api.reply = async() => { throw new Error('private url and sql') };
  const one = f.run(f.event()), two = f.run(f.event());
  unblock(); await Promise.all([one, two]);
  assert.equal(f.writes.length, 1);
  assert.ok(!f.logs.join('').includes('private url'));
  f.api.reply = async(...args) => f.replies.push(args);
  await f.run(f.event()); await f.run(f.event());
  assert.equal(f.writes.length, 1);
  assert.equal(f.replies.length, 1);
});

test('QQ native msg_idx array distinguishes messages and assigns stable reply sequence', async() => {
  const f = fixture();
  const a = f.event({message_scene: {ext: ['auth_token=secret', 'msg_idx=A==']}});
  const b = f.event({message_scene: {ext: ['msg_idx=B==']}});
  await f.run(a); await f.run(b); await f.run(a);
  assert.equal(f.writes.length, 2);
  assert.notEqual(f.replies[0][3], f.replies[1][3]);
});

test('QQ partial upload failure is terminal and does not leak storage or database errors', async() => {
  const f = fixture();
  f.failUpload(Object.assign(new Error('https://secret SQL SELECT'), {code: 'MEDIA_REGISTRATION_FAILED', uploadedUrl: 'https://private'}));
  const message = f.event({attachments: [{content_type: 'image/jpeg'}]});
  await f.run(message); await f.run(message);
  assert.equal(f.writes.length, 0);
  assert.equal(f.replies.length, 1);
  assert.equal(f.uploads.length, 1);
  assert.match(f.replies[0][2], /文件已上传，但媒体登记失败/);
  assert.match(f.logs.join(''), /MEDIA_REGISTRATION_FAILED/);
  assert.doesNotMatch(f.logs.join('') + f.replies[0][2], /https:|SELECT/);
});

test('QQ stop or author revocation during download prevents subsequent upload and save', async() => {
  for (const revoke of [f => f.stop(), f => { f.settings.qqAllowedOpenIds = '' }, f => { f.settings.authorId = 9 }]) {
    const f = fixture();
    const download = f.api.download;
    f.api.download = async item => { revoke(f); return download(item) };
    await f.run(f.event({attachments: [{content_type: 'image/jpeg'}]}));
    assert.equal(f.uploads.length, 0);
    assert.equal(f.writes.length, 0);
  }
});

test('QQ rejects unsupported structured and mixed attachments without downloading', async() => {
  const f = fixture();
  for (const data of [{message_type: 103}, {attachments: [{content_type: 'video/mp4'}]},
    {attachments: [{content_type: 'image/jpeg'}, {content_type: 'audio/mpeg'}]}]) {
    await f.run(f.event({id: JSON.stringify(data), ...data}));
  }
  assert.equal(f.downloads.length, 0);
  assert.equal(f.writes.length, 0);
});
