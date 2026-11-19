'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {uploadBuffer} = require('../lib/media');

function ogg(packet) {
  const header = Buffer.alloc(28);
  header.write('OggS');
  header[5] = 2;
  header[26] = 1;
  header[27] = packet.length;
  return Buffer.concat([header, packet]);
}

const opus = Buffer.alloc(19);
opus.write('OpusHead');
opus[8] = 1;
opus[9] = 1;
const vorbis = Buffer.alloc(30);
vorbis[0] = 1;
vorbis.write('vorbis', 1);
vorbis[11] = 1;
vorbis.writeUInt32LE(48000, 12);
vorbis[29] = 1;

for (const packet of [opus, vorbis]) {
  for (const mime of ['application/x-vendor-audio', 'binary/octet-stream', 'audio/x-unknown']) {
    test(`normalizes verified ${packet === opus ? 'Opus' : 'Vorbis'} with ${mime}`, async() => {
      const bytes = ogg(packet);
      let calls = 0;
      const result = await uploadBuffer(bytes, {filename: 'recording.bin', mime, userId: 7}, {
        mediaUpload: async input => {
          calls++;
          assert.equal(input.mime, 'audio/ogg');
          assert.equal(input.filename, 'recording.ogg');
          assert.equal(input.ownerId, 7);
          assert.deepEqual(input.data, bytes);
          return {url: '/recording.ogg'};
        }
      });
      assert.equal(result, '/recording.ogg');
      assert.equal(calls, 1);
    });
  }
}

test('unknown MIME fallback rejects truncated, non-audio and invalid Ogg headers', async() => {
  const invalidChannels = Buffer.from(opus);
  invalidChannels[9] = 0;
  for (const bytes of [Buffer.from('OggS'), ogg(Buffer.from('theora')), ogg(invalidChannels),
    ogg(opus).subarray(0, 35), Buffer.from('not audio')]) {
    await assert.rejects(uploadBuffer(bytes, {filename: 'voice.opus', mime: 'application/x-unknown', userId: 7}, {
      mediaUpload: async() => assert.fail('invalid media reached storage')
    }), {code: 'MEDIA_TYPE_UNSUPPORTED'});
  }
});

test('known image MIME mismatch and size restrictions remain enforced', async() => {
  await assert.rejects(uploadBuffer(ogg(opus), {filename: 'image.png', mime: 'image/png', userId: 7}),
    {code: 'MEDIA_TYPE_MISMATCH'});
  await assert.rejects(uploadBuffer(Buffer.alloc(20 * 1024 * 1024 + 1),
    {filename: 'voice', mime: 'application/x-unknown', userId: 7}), {code: 'MEDIA_SIZE_INVALID'});
});
