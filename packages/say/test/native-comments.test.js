'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {NativeComments, supportsNative, renderNativeComments} = require('../lib/native-comments');
const {escapeHtml} = require('../lib/render');
function fixture({supported = true, type = 3, closed = false} = {}) {
  const host = {pathnameFromUrl: () => supported ? {pathname: 'probe', type: 3} : null,
    resolveCommentPostId: async() => 42};
  const publicConfig = {serverURL: 'https://example.com/api/comment', resources: {script: '/waline.js', style: '/waline.css'},
    login: 'force', turnstileKey: 'public-site-key', requiredMeta: ['nick']};
  const comments = {target: async() => {
    if (closed) throw Object.assign(new Error('closed'), {status: 403});
    return {id: 42, pathname: '中文&a%2Fb.html'};
  }};
  const getModel = name => name === 'options' ? {getOptions: async() => ({jwt_secret: 'PRIVATE', site_url: 'https://example.com'})}
    : {where: () => ({field: () => ({find: async() => ({id: 42, type})})})};
  const getService = () => ({render: () => `<div data-comment-config="${escapeHtml(JSON.stringify(publicConfig))}"></div>`});
  return new NativeComments({host, comments, getModel, getService});
}
test('native configuration reuses public host settings and encodes pathname exactly once after Waline normalization', async() => {
  const result = await fixture().configuration(42, {state: {}});
  assert.equal(result.native, true);
  assert.equal(result.config.serverURL, '/api/comment');
  assert.equal(result.config.login, 'force');
  assert.equal(result.config.turnstileKey, 'public-site-key');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|jwt_secret/);
  const target = new URL(decodeURI(result.config.path), 'https://example.com');
  assert.equal(target.searchParams.get('pathname'), '中文&a%2Fb.html');
  assert.equal(target.searchParams.get('type'), '3');
  assert.equal(decodeURI(result.config.path), result.target);
});
test('old core exposes a legacy link and never fabricates native support', async() => {
  assert.equal(supportsNative({}), false);
  assert.deepEqual(await fixture({supported: false}).configuration(42, {}), {native: false, detailUrl: '/says/42'});
});
test('native submissions preserve Say settings and moderation across URL aliases', async() => {
  const input = {url: '/post/same.html', comment: 'hello', status: 'approved'};
  assert.equal((await fixture().beforeCreate(input)).status, 'waiting');
  assert.equal((await fixture().beforeCreate({...input, status: 'spam'})).status, 'spam');
  assert.equal(await fixture({type: 0}).beforeCreate(input), input);
  await assert.rejects(fixture({closed: true}).beforeCreate(input), /closed/);
  await assert.rejects(fixture({closed: true}).configuration(42, {}), /closed/);
});
test('detail renderer uses an isolated container and shared client', () => {
  assert.match(renderNativeComments(42), /data-say-comments="42"/);
  assert.match(renderNativeComments(42), /comment-client.js/);
});
