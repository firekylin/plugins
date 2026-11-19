'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createQqApi, mediaUrl, gatewayUrl, readBytes} = require('../lib/qq-api');
const json = (data, status = 200) => new Response(JSON.stringify(data), {status});

test('QQ uses cached credentials, selected sandbox and a stable passive reply sequence', async() => {
  const calls = [];
  const api = createQqApi({qqAppId: 'app', qqAppSecret: 'secret', qqSandbox: true}, {fetchImpl: async(url, options) => {
    calls.push({url, options});
    if (url.endsWith('getAppAccessToken')) return json({access_token: 'TOKEN', expires_in: '7200'});
    if (url.endsWith('/gateway')) return json({url: 'wss://api.bot.qq.com/websocket/'});
    return json({id: 'sent'});
  }});
  await Promise.all([api.token(), api.token()]);
  await api.gateway();
  await api.reply('USER', 'MSG', '已发布 #1', 23);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://api.bot.qq.com/app/getAppAccessToken');
  assert.deepEqual(JSON.parse(calls[0].options.body), {appId: 'app', clientSecret: 'secret'});
  assert.equal(calls[1].url, 'https://sandbox.api.sgroup.qq.com/gateway');
  assert.equal(calls[2].options.headers.Authorization, 'QQBot TOKEN');
  assert.deepEqual(JSON.parse(calls[2].options.body), {content: '已发布 #1', msg_type: 0, msg_id: 'MSG', msg_seq: 23});
  assert.equal(calls[2].options.redirect, 'error');
});

test('QQ checks HTTP-200 business errors and never exposes upstream messages', async() => {
  const api = createQqApi({}, {fetchImpl: async() => json({code: 100016, message: 'SECRET https://internal'})});
  await assert.rejects(api.token(), error => error.qqCode === 100016 && !error.message.includes('SECRET'));
});

test('QQ reply deduplication is success; other errors are not automatically resent', async() => {
  let replies = 0;
  const api = createQqApi({}, {fetchImpl: async url => {
    if (url.endsWith('getAppAccessToken')) return json({access_token: 'T', expires_in: 7200});
    replies++; return json({code: replies === 1 ? 40054005 : 40034005, message: 'private'});
  }});
  assert.deepEqual(await api.reply('U', 'M', 'hi'), {duplicate: true});
  await assert.rejects(api.reply('U', 'M', 'hi'), error => error.qqCode === 40034005);
  assert.equal(replies, 2);
});

test('QQ validates gateway and attachment destinations including subdomain boundaries', () => {
  assert.ok(mediaUrl('https://multimedia.nt.qq.com.cn/a'));
  assert.ok(gatewayUrl('wss://api.bot.qq.com/websocket'));
  for (const url of ['http://nt.qq.com/a', 'https://nt.qq.com.evil.test/a', 'https://localhost/a',
    'https://user:pass@nt.qq.com/a', 'https://nt.qq.com:8443/a']) assert.throws(() => mediaUrl(url));
  for (const url of ['ws://api.bot.qq.com/a', 'wss://evil.test/a', 'wss://user:pass@api.bot.qq.com/a']) assert.throws(() => gatewayUrl(url));
});

test('QQ voice downloads use converted WAV, no bot credentials, and disallow redirects', async() => {
  const calls = [];
  const api = createQqApi({}, {fetchImpl: async(url, options) => {
    calls.push({url: String(url), options}); return new Response(Buffer.from('wave'));
  }});
  const media = await api.download({url: 'https://nt.qq.com/raw', content_type: 'voice', voice_wav_url: 'https://nt.qq.com/wav'});
  assert.equal(media.mime, 'audio/wav');
  assert.equal(media.filename, 'qq-voice.wav');
  assert.equal(calls[0].url, 'https://nt.qq.com/wav');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers, undefined);
  await assert.rejects(api.download({url: 'https://localhost/secret'}));
  assert.equal(calls.length, 1);
});

test('QQ download bounds both advertised and streamed bytes', async() => {
  await assert.rejects(readBytes(new Response('x', {headers: {'content-length': '999'}}), 8), {code: 'MEDIA_SIZE_INVALID'});
  const stream = new ReadableStream({start(controller) {
    controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); controller.close();
  }});
  await assert.rejects(readBytes(new Response(stream), 8), {code: 'MEDIA_SIZE_INVALID'});
});
