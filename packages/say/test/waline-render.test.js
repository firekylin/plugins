'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {renderWalineComments} = require('../lib/comment-render');

async function initialize(html, origin) {
  const container = {dataset: {config: html.match(/data-config="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')}};
  const requests = [];
  let initialized;
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace("import('https://cdn.jsdelivr.net/npm/@waline/client@3.16.0/dist/waline.js')", 'Promise.resolve(mockClient)');
  await vm.runInNewContext('(async () => {' + script + '})()', {
    URL, window: {location: {origin}}, document: {getElementById: () => container},
    localStorage: {removeItem() {}, setItem() {}},
    mockClient: {init: config => { initialized = config }},
    fetch: async url => { requests.push(url); return {ok: true, json: async() => ({errno: 0, data: null})} }
  });
  assert.ok(initialized, 'Inline initialization must succeed');
  assert.deepEqual(requests, [origin + '/api/comment/api/token']);
  return initialized;
}

test('detail page initializes Waline with a generic explicit target and only public settings', async() => {
  const html = renderWalineComments({id: 7, pathname: 'a&b%2F中文'}, {
    options: {jwt_secret: 'PRIVATE', comment: {forceLogin: true, requiredMeta: ['nick']}},
    public: {forceLogin: true, captcha: {provider: 'turnstile', siteKey: 'PUBLIC'}}
  });
  const config = await initialize(html, 'https://example.com');
  const target = new URL(decodeURI(config.path), 'https://example.com');
  assert.equal(target.pathname, '/says/7');
  assert.equal(target.searchParams.get('pathname'), 'a&b%2F中文');
  assert.equal(target.searchParams.get('type'), '3');
  assert.equal(config.serverURL, 'https://example.com/api/comment');
  assert.equal(config.login, 'force');
  assert.equal(config.turnstileKey, 'PUBLIC');
  assert.doesNotMatch(html, /PRIVATE|comment-client\.js|comments\/7\/config/);
  assert.match(html, /client.init/);
});


test('Waline GET and POST paths retain the explicit database target after client decoding', async() => {
  for (const pathname of ['say-1795060504709-8d4a4cffbf2e', '中文/路径', 'a&b?c#d', 'literal%2F+ space']) {
    const html = renderWalineComments({id: 150017, pathname}, {
      options: {}, public: {}
    });
    const config = await initialize(html, 'http://localhost:8360');
    assert.equal(config.serverURL, 'http://localhost:8360/api/comment');
    // Match the pinned client's path normalization, then its HTTP serialization.
    const normalized = decodeURI(config.path);
    const request = new URL(config.serverURL + '/api/comment');
    request.searchParams.set('path', normalized);
    assert.equal(request.host, 'localhost:8360');
    for (const value of [request.searchParams.get('path'), JSON.parse(JSON.stringify({url: normalized})).url]) {
      const target = new URL(value, 'http://localhost:8360');
      assert.equal(target.pathname, '/says/150017');
      assert.equal(target.searchParams.get('pathname'), pathname);
      assert.equal(target.searchParams.get('type'), '3');
    }
    assert.match(html, /fetch\(config.serverURL \+ '\/api\/token'/);
  }
});

test('missing stored pathname cannot silently become an undefined or numeric comment target', () => {
  for (const pathname of [undefined, '', ' ']) {
    assert.throws(() => renderWalineComments({id: 7, pathname}, {
      options: {}, public: {}
    }), /stored Say pathname/);
  }
});
