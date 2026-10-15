'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {Registry, trustedUrl, verify} = require('../lib/registry');

function response(body, status = 200, headers = {}) {
  const buffer = Buffer.from(body);
  return {status, ok: status >= 200 && status < 300, headers: {get: name => headers[name.toLowerCase()] || null},
    async arrayBuffer() { return buffer }};
}

test('loads a valid registry from an allowed official URL', async() => {
  const body = JSON.stringify({schemaVersion: 1, packages: [
    {type: 'plugin', name: '@firekylin/plugin-demo', version: '1.0.0'}, {invalid: true}
  ]});
  const registry = new Registry({fetcher: async() => response(body)});
  assert.deepEqual(await registry.list(), [
    {type: 'plugin', name: '@firekylin/plugin-demo', version: '1.0.0'}
  ]);
});

test('rejects untrusted registry and redirect targets', () => {
  assert.throws(() => trustedUrl('http://raw.githubusercontent.com/firekylin/plugins/main/registry.json'), /UNTRUSTED/);
  assert.throws(() => trustedUrl('https://127.0.0.1/registry.json'), /UNTRUSTED/);
  assert.throws(() => trustedUrl('https://raw.githubusercontent.com/other/repo/main/registry.json'), /UNTRUSTED/);
});

test('verifies theme archive integrity', () => {
  const content = Buffer.from('theme');
  const integrity = `sha512-${crypto.createHash('sha512').update(content).digest('base64')}`;
  assert.doesNotThrow(() => verify(content, integrity));
  assert.throws(() => verify(Buffer.from('changed'), integrity), /MISMATCH/);
});
