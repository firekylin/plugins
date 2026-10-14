'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {decodeBase64Media, detectedType, uploadBuffer} = require('../lib/media');
const {normalizeNeteaseUrl, resolveNeteaseMusic} = require('../lib/netease');
const {decrypt, encrypt, encryptedReply, parseXml, signature, verify} = require('../lib/wecom');

test('normalizes and resolves supported NetEase song links only', async() => {
  assert.equal(normalizeNeteaseUrl('https://music.163.com/song?id=123'), 'https://music.163.com/song?id=123');
  assert.equal(normalizeNeteaseUrl('https://music.163.com/#/song?id=456'), 'https://music.163.com/song?id=456');
  assert.equal(normalizeNeteaseUrl('https://evil.test/song?id=123'), null);
  const item = await resolveNeteaseMusic({kind: 'music', url: 'https://music.163.com/song?id=123'}, async url => {
    assert.equal(String(url), 'https://music.163.com/song?id=123');
    return {ok: true, text: async() => '<meta property="og:title" content="Song &amp; More">' +
      '<meta property="music:musician" content="Artist"><meta property="og:image" content="https://img.test/a.jpg">'};
  });
  assert.equal(item.title, 'Song & More');
  assert.equal(item.artist, 'Artist');
  assert.equal(item.cover, 'https://img.test/a.jpg');
});

test('encrypts, verifies and parses WeCom callback messages', () => {
  const key = Buffer.alloc(32, 7).toString('base64').replace(/=$/, '');
  const xml = '<xml><ToUserName><![CDATA[corp]]></ToUserName><FromUserName><![CDATA[user]]></FromUserName>' +
    '<MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello]]></Content></xml>';
  const encrypted = encrypt(xml, key, 'corp');
  assert.equal(decrypt(encrypted, key, 'corp'), xml);
  const digest = signature('token', '1', 'nonce', encrypted);
  assert.equal(verify({token: 'token', timestamp: '1', nonce: 'nonce', encrypted, msgSignature: digest}), true);
  assert.deepEqual(parseXml(xml).Content, 'hello');
  assert.match(encryptedReply(xml, {wecomEncodingAESKey: key, wecomCorpId: 'corp', wecomToken: 'token'}, '1', 'nonce'),
    /<Encrypt><!\[CDATA\[/);
});

test('validates base64 media size and syntax', () => {
  const decoded = decodeBase64Media('data:image/png;base64,aGVsbG8=');
  assert.equal(decoded.buffer.toString(), 'hello');
  assert.equal(decoded.mime, 'image/png');
  assert.throws(() => decodeBase64Media('%%%'), /Invalid base64/);
  assert.equal(detectedType(Buffer.from('89504e470d0a1a0a', 'hex')), 'image/png');
  assert.equal(detectedType(Buffer.from('<html>')), '');
});

test('uploads media through the configured Firekylin provider and fixes mismatched extensions', async() => {
  let received;
  const url = await uploadBuffer(Buffer.from('89504e470d0a1a0a', 'hex'),
    {filename: 'photo.jpg', mime: 'image/png'}, {
      getOptions: async() => ({upload: {type: 'local'}}),
      getUploader: name => ({run: async(file, config) => {
        received = {name, file, config};
        return '/static/upload/photo.png';
      }})
    });
  assert.equal(url, '/static/upload/photo.png');
  assert.equal(received.name, 'local');
  assert.equal(received.config.file.name, 'photo.png');
  await assert.rejects(uploadBuffer(Buffer.from('<html>'), {filename: 'photo.jpg', mime: 'image/jpeg'}),
    /does not match/);
});
