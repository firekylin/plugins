'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {createMediaClient} = require('../lib/media');

const bytes = Buffer.from('OggS-opus-fixture');

test('bound host media handles buffers and base64 without reading models or global upload services', async t => {
  const originalThink = global.think;
  const originalFirekylin = global.firekylin;
  t.after(() => { global.think = originalThink; global.firekylin = originalFirekylin; });
  global.think = {model() { assert.fail('unexpected model access'); }};
  global.firekylin = {uploadMedia() { assert.fail('unexpected global upload'); }};
  const calls = [];
  const client = createMediaClient({upload: async input => { calls.push(input); return {url: '/voice.ogg', id: 7}; }});
  for (const mime of ['audio/opus', 'application/ogg', 'audio/x-ogg', 'audio/ogg']) {
    assert.equal(await client.uploadBuffer(bytes, {filename: 'voice', mime, userId: 19}), '/voice.ogg');
  }
  assert.equal(await client.uploadBase64(bytes.toString('base64'),
    {filename: 'voice', mime: 'audio/opus', userId: 20}), '/voice.ogg');
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.mime, 'audio/ogg');
    assert.equal(call.filename, 'voice.ogg');
    assert.deepEqual(call.data, bytes);
    assert.deepEqual(Object.keys(call).sort(), ['data', 'filename', 'mime', 'ownerId']);
  }
  assert.equal(calls[4].ownerId, 20);
});

test('permission and partial-upload failures never downgrade to the legacy adapter', async t => {
  const originalThink = global.think;
  const originalFirekylin = global.firekylin;
  t.after(() => { global.think = originalThink; global.firekylin = originalFirekylin; });
  global.think = {model() { assert.fail('unexpected model access'); }};
  global.firekylin = {uploadMedia() { assert.fail('unexpected fallback'); }};
  for (const code of ['PLUGIN_MEDIA_DENIED', 'MEDIA_OWNER_DENIED', 'MEDIA_REGISTRATION_FAILED']) {
    const error = Object.assign(new Error('failure'), {code});
    let calls = 0;
    const client = createMediaClient({upload: async() => { calls++; throw error; }});
    await assert.rejects(client.uploadBuffer(bytes, {filename: 'voice.ogg', mime: 'audio/ogg', userId: 7}),
      actual => actual === error);
    assert.equal(calls, 1);
  }
  for (const media of [null, {}, {upload: false}]) assert.throws(() => createMediaClient(media), /Invalid host/);
});

test('hosts without ctx.media retain transitional global upload support without retrying failures', async t => {
  const originalThink = global.think;
  const originalFirekylin = global.firekylin;
  t.after(() => { global.think = originalThink; global.firekylin = originalFirekylin; });
  global.think = {model: () => ({getOptions: async() => ({upload: {type: 'local'}})}),
    service() { assert.fail('must not retry a global API failure'); }};
  const failure = Object.assign(new Error('registration failed'), {code: 'MEDIA_REGISTRATION_FAILED'});
  let calls = 0;
  global.firekylin = {uploadMedia: async input => { calls++; assert.equal(input.userId, 9); throw failure; }};
  const client = createMediaClient();
  await assert.rejects(client.uploadBuffer(bytes, {filename: 'voice.ogg', mime: 'audio/ogg', userId: 9}),
    actual => actual === failure);
  assert.equal(calls, 1);
});
