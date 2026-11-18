'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {uploadBuffer, uploadBase64, downloadFeishuResource} = require('../lib/media');
const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead'), Buffer.alloc(11)]);

for (const mime of ['audio/opus', 'application/ogg', 'audio/x-ogg', 'Audio/Opus; codecs=opus',
  'application/octet-stream', 'audio/ogg']) {
  test(`uploads Ogg/Opus as registered audio with MIME ${mime}`, async() => {
    let uploaded;
    const url = await uploadBuffer(ogg, {filename: 'voice', mime, userId: 17}, {
      getOptions: async() => ({upload: {type: 'r2'}}),
      getUploader: () => { throw new Error('must not bypass unified API'); },
      uploadMedia: async input => {
        uploaded = input;
        assert.deepEqual(await fs.readFile(input.file.path), ogg);
        return {url: '/voice.ogg', id: 51};
      }
    });
    assert.equal(url, '/voice.ogg');
    assert.equal(uploaded.userId, 17);
    assert.equal(uploaded.config.type, 'r2');
    assert.equal(uploaded.file.type, 'audio/ogg');
    assert.equal(uploaded.file.name, 'voice.ogg');
    await assert.rejects(fs.access(uploaded.file.path), {code: 'ENOENT'});
  });
}

test('base64 preserves explicit author and returns URL', async() => {
  assert.equal(await uploadBase64(ogg.toString('base64'),
    {filename: 'voice.opus', mime: 'audio/opus', userId: 22}, {
      getOptions: async() => ({upload: {type: 'local'}}),
      uploadMedia: async input => {
        assert.equal(input.userId, 22);
        assert.equal(input.file.type, 'audio/ogg');
        return {url: '/voice.opus', id: 1};
      }
    }), '/voice.opus');
});

test('unified upload failure propagates unchanged, cleans temporary file and never falls back', async() => {
  let filename;
  let calls = 0;
  const error = Object.assign(new Error('registration failed'), {
    code: 'MEDIA_REGISTRATION_FAILED', uploadedUrl: '/voice.ogg', retryable: false
  });
  await assert.rejects(uploadBuffer(ogg, {filename: 'voice.ogg', mime: 'audio/ogg', userId: 9}, {
    getOptions: async() => ({upload: {type: 'local'}}),
    getUploader: () => { throw new Error('unexpected fallback'); },
    uploadMedia: async input => { calls++; filename = input.file.path; throw error; }
  }), actual => actual === error);
  assert.equal(calls, 1);
  await assert.rejects(fs.access(filename), {code: 'ENOENT'});
});

test('legacy core keeps URL upload behavior and warns about unavailable registration', async() => {
  const warnings = [];
  assert.equal(await uploadBuffer(ogg, {filename: 'voice.ogg', mime: 'audio/ogg', userId: 9}, {
    getOptions: async() => ({upload: {type: 'r2'}}),
    warn: message => warnings.push(message),
    getUploader: type => {
      assert.equal(type, 'files-sdk');
      return {run: async() => '/legacy.ogg'};
    }
  }), '/legacy.ogg');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /registration unavailable/);
});

test('unknown bytes, MIME mismatch and missing owners fail before uploading', async() => {
  await assert.rejects(uploadBuffer(Buffer.from('OpusHead-raw-not-an-ogg-container'),
    {filename: 'voice.opus', mime: 'audio/opus', userId: 9}), /does not match/);
  await assert.rejects(uploadBuffer(ogg, {filename: 'image.png', mime: 'image/png', userId: 9}), /does not match/);
  await assert.rejects(uploadBuffer(ogg, {filename: 'voice.ogg', mime: 'audio/ogg'}), /explicit upload owner/);
});

test('Feishu resource download uses file endpoint and preserves Ogg bytes through registration', async() => {
  let downloaded = false;
  const media = await downloadFeishuResource('om_audio', 'file_audio', 'file', {
    feishuAppId: 'media-regression', feishuAppSecret: 'test'
  }, async value => {
    const url = String(value);
    if (url.includes('/auth/')) return {ok: true, json: async() => ({tenant_access_token: 'test', expire: 7200})};
    assert.match(url, /messages\/om_audio\/resources\/file_audio\?type=file$/);
    downloaded = true;
    return {ok: true, headers: new Headers({'content-type': 'application/ogg',
      'content-disposition': 'attachment; filename="voice.opus"'}), arrayBuffer: async() => ogg};
  });
  assert.equal(downloaded, true);
  assert.equal(await uploadBuffer(media.buffer, {...media, userId: 42}, {
    getOptions: async() => ({upload: {type: 'local'}}),
    uploadMedia: async input => {
      assert.equal(input.userId, 42);
      assert.equal(input.file.type, 'audio/ogg');
      assert.deepEqual(await fs.readFile(input.file.path), ogg);
      return {url: '/voice.opus', id: 8};
    }
  }), '/voice.opus');
});
