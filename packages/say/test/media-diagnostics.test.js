'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {uploadBuffer} = require('../lib/media');
const {step, diagnostic, logDetails} = require('../lib/publish-feedback');

for (const [mime, bytes, code, detected] of [
  ['audio/mp4', Buffer.from('example'), 'MEDIA_TYPE_UNSUPPORTED', 'unknown'],
  ['audio/ogg', Buffer.from('example'), 'MEDIA_TYPE_MISMATCH', 'unknown'],
  ['audio/aac', Buffer.from('OggS'), 'MEDIA_TYPE_UNSUPPORTED', 'audio/ogg'],
  ['audio/ogg', Buffer.alloc(0), 'MEDIA_SIZE_INVALID', 'unknown']
]) {
  test(`reports ${code} for ${mime} before invoking storage`, async() => {
    await assert.rejects(step('upload', () => uploadBuffer(bytes,
      {filename: 'private-name', mime, userId: 1}, {
        mediaUpload: async() => assert.fail('invalid media must not reach storage')
      })), error => {
      assert.match(diagnostic(error), new RegExp(code));
      const details = JSON.parse(logDetails(error));
      assert.deepEqual(details.causes[1].media, {mime, detected, bytes: bytes.length});
      assert.doesNotMatch(logDetails(error), /private-name|example/);
      return true;
    });
  });
}

test('never logs arbitrary MIME header contents or file data', async() => {
  await assert.rejects(step('upload', () => uploadBuffer(Buffer.from('private-recording'),
    {filename: 'private-filename', mime: 'audio/private-secret', userId: 1})), error => {
    assert.equal(JSON.parse(logDetails(error)).causes[1].media.mime, 'other');
    assert.doesNotMatch(diagnostic(error) + logDetails(error), /private/);
    return true;
  });
});
