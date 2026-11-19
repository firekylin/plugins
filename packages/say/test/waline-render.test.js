'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {renderWalineComments, supportsNativeComments} = require('../lib/comment-render');

test('detail page initializes Waline with a generic explicit target and only public settings', () => {
  const html = renderWalineComments({id: 7, pathname: 'a&b%2F中文'}, {
    options: {jwt_secret: 'PRIVATE', comment: {forceLogin: true, requiredMeta: ['nick']}},
    public: {forceLogin: true, captcha: {provider: 'turnstile', siteKey: 'PUBLIC'}}
  });
  const config = JSON.parse(html.match(/data-config="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const target = new URL(decodeURI(config.path), 'https://example.com');
  assert.equal(target.pathname, '/says/7');
  assert.equal(target.searchParams.get('pathname'), 'a&b%2F中文');
  assert.equal(target.searchParams.get('type'), '3');
  assert.equal(config.serverURL, '/api/comment');
  assert.equal(config.login, 'force');
  assert.equal(config.turnstileKey, 'PUBLIC');
  assert.doesNotMatch(html, /PRIVATE|comment-client\.js|comments\/7\/config/);
  assert.match(html, /client.init/);
});

test('native capability probe requires generic query support and retains old-core fallback', () => {
  assert.equal(supportsNativeComments(() => null), false);
  assert.equal(supportsNativeComments(() => { throw new Error('old') }), false);
  assert.equal(supportsNativeComments(url => {
    assert.equal(url, '/says?pathname=probe&type=3');
    return {pathname: 'probe', type: 3};
  }), true);
});
