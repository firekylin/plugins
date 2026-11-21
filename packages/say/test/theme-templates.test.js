'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {SayService} = require('../lib/say-service');
const {SayComments} = require('../lib/comments');
const {FrontendPublish} = require('../lib/frontend-publish');
const {createSayViewModel} = require('../lib/render');
const {detailUrl, tagUrl, pageUrl} = require('../lib/urls');

function setup(t) {
  const item = (id, status = 'public') => ({id, status, pathname: `stored-${id}`,
    kind: 'text', text: `Say ${id} <script>`, tags: ['中文 & #/?'], images: [],
    createdAt: `2026-11-${id + 10} 12:00:00`, commentCount: 2, allowComments: true});
  const state = {settings: {enabled: true, pageSize: 1, amapKey: 'PRIVATE_MAP', apiKey: 'PRIVATE_API',
    qqAppSecret: 'PRIVATE_QQ', feishuEncryptKey: 'PRIVATE_FEISHU'},
  items: [item(3), item(2), item(1), item(4, 'private'), item(5, 'hidden')],
  identity: {loggedIn: false}, neighbors: {previous: 1, next: 3}};
  t.mock.method(SayService.prototype, 'settings', async() => state.settings);
  t.mock.method(SayService.prototype, 'all', async() => state.items);
  t.mock.method(SayService.prototype, 'get', async id => {
    const value = state.items.find(item => item.id === Number(id));
    if (!value) throw Object.assign(new Error('Say was not found'), {status: 404});
    return value;
  });
  t.mock.method(SayService.prototype, 'publicNeighbors', async() => state.neighbors);
  t.mock.method(FrontendPublish.prototype, 'identity', async() => state.identity);
  t.mock.method(SayComments.prototype, 'configuration', async() => ({
    options: {jwt_secret: 'PRIVATE_JWT', comment: {smtpPass: 'PRIVATE_SMTP'}}, public: {forceLogin: false}}));
  const originalThink = global.think;
  global.think = {model: name => {
    assert.equal(name, 'options');
    return {getOptions: async() => ({title: 'My blog', jwt_secret: 'PRIVATE_JWT'})};
  }};
  t.after(() => { global.think = originalThink });
  const routes = [];
  const noop = () => {};
  require('../plugin').register({logger: {info: noop}, widgets: {Widget: class {}, register: noop},
    events: {on: noop}, templates: {registerFunction: noop}, routes: {register: value => routes.push(value)},
    admin: {registerPanel: noop, registerPage: noop, registerForm: noop, registerAction: noop}});
  return {...state, routes, state, async request(path, {params = {}, query = {}, renderTheme} = {}) {
    const route = routes.find(route => route.scope === 'site' && route.path === path);
    const headers = {};
    const ctx = {state: {}, set(name, value) {headers[name] = value},
      throw(status) {throw Object.assign(new Error('Not found'), {status})}};
    await route.handler({ctx, params, query, renderTheme});
    return {ctx, headers};
  }};
}

for (const [route, params, query, template] of [
  ['/says', {}, {}, 'list'],
  ['/says/tag/:tag', {tag: '中文 & #/?'}, {}, 'tag'],
  ['/says', {}, {tag: '中文 & #/?'}, 'tag'],
  ['/says/:id', {id: '2'}, {}, 'detail']
]) {
  test(`${route} ${template} uses the matching override and exposes public data only`, async t => {
    const f = setup(t);
    let observed;
    const response = await f.request(route, {params, query, renderTheme: async(name, data) => {
      observed = {name, data};
      return `<main>custom ${name}</main>`;
    }});
    assert.equal(observed.name, template);
    assert.deepEqual(Object.keys(observed.data), ['say']);
    const model = observed.data.say;
    assert.equal(model.view, template);
    assert.ok(model.items.every(item => item.status === 'public'));
    assert.equal(response.ctx.body, `<main>custom ${template}</main>`);
    assert.match(response.ctx.type, /^text\/html/);
    assert.equal(response.headers['Cache-Control'], template === 'detail' ? 'no-store' : 'private, no-store');
    assert.doesNotMatch(JSON.stringify(model), /PRIVATE_/);
    assert.doesNotMatch(model.html.items, /<script>/);
    assert.match(model.html.items, /&lt;script&gt;/);
    assert.equal(model.items[0].detailUrl, detailUrl(model.items[0].id));
    assert.equal(model.items[0].tagLinks[0].url, tagUrl('中文 & #/?'));
    if (template === 'detail') {
      assert.equal(model.item.id, 2);
      assert.equal(model.urls.current, '/says/2');
      assert.deepEqual(model.navigation, {previous: {id: 1, url: '/says/1'}, next: {id: 3, url: '/says/3'}});
      assert.match(model.html.comments, /pathname=stored-2&amp;type=3/);
      assert.equal(model.html.composer, '');
    } else {
      assert.equal(model.item, null);
      assert.equal(model.pagination.total, 3);
      assert.match(model.html.composer, /\/admin\/login\?redirect=%2Fsays/);
    }
  });
}

test('a theme may override just one page; undefined and older cores retain built-in rendering', async t => {
  const f = setup(t);
  const renderTheme = async name => name === 'list' ? '<main>only list</main>' : undefined;
  assert.equal((await f.request('/says', {renderTheme})).ctx.body, '<main>only list</main>');
  for (const [route, params] of [['/says/tag/:tag', {tag: '中文 & #/?'}], ['/says/:id', {id: '2'}]]) {
    const partial = await f.request(route, {params, renderTheme});
    const legacy = await f.request(route, {params});
    assert.equal(partial.ctx.body, legacy.ctx.body);
    assert.match(partial.ctx.body, /^<!doctype html>/);
  }
  assert.match((await f.request('/says')).ctx.body, /^<!doctype html>/);
  // Empty HTML is an intentional override, not a missing file.
  assert.equal((await f.request('/says', {renderTheme: async() => ''})).ctx.body, '');
});

test('template errors propagate rather than disguising a broken theme with fallback HTML', async t => {
  const f = setup(t);
  const error = new Error('broken include');
  for (const [route, params] of [['/says', {}], ['/says/tag/:tag', {tag: 'tag'}], ['/says/:id', {id: '2'}]]) {
    await assert.rejects(f.request(route, {params, renderTheme: async() => {throw error}}), value => value === error);
  }
});

test('disabled/private/hidden/missing detail cannot reach a template and lists stay public-only', async t => {
  const f = setup(t);
  let calls = 0;
  const renderTheme = async() => { calls++; return 'rendered' };
  for (const id of ['4', '5', '99', '0', '1.html']) {
    await assert.rejects(f.request('/says/:id', {params: {id}, renderTheme}), {status: 404});
  }
  f.state.settings.enabled = false;
  await assert.rejects(f.request('/says/:id', {params: {id: '2'}, renderTheme}), {status: 404});
  assert.equal(calls, 0);
  for (const status of ['private', 'hidden', 'public']) {
    const response = await f.request('/says', {query: {publicOnly: false, status},
      renderTheme: async(name, {say}) => {assert.deepEqual(say.items, []); return say.html.composer}});
    assert.equal(response.ctx.body, '');
  }
});

test('pagination keeps path and query-tag forms, encoding tags and sharing links with fallback', async t => {
  const f = setup(t);
  const tag = '中文 & #/?';
  for (const [route, params, pathname] of [
    ['/says', {}, '/says'], ['/says/tag/:tag', {tag}, tagUrl(tag)]
  ]) {
    let model;
    const query = {tag, page: 2, token: 'DO_NOT_LINK'};
    await f.request(route, {params, query, renderTheme: async(name, {say}) => { model = say; return '' }});
    assert.equal(model.pagination.previousUrl, pageUrl(1, tag, pathname));
    assert.equal(model.pagination.nextUrl, pageUrl(3, tag, pathname));
    assert.equal(model.pagination.totalPages, 3);
    const fallback = (await f.request(route, {params, query})).ctx.body;
    for (const value of [model.pagination.previousUrl, model.pagination.nextUrl]) {
      assert.ok(fallback.includes(`href="${value.replaceAll('&', '&amp;')}"`));
    }
    assert.doesNotMatch(fallback, /DO_NOT_LINK/);
  }
});

test('composer, comments and adjacency remain reusable without exposing raw identity or settings', async t => {
  const f = setup(t);
  f.state.identity = {loggedIn: true, canPublish: true, id: 1, csrf: 'request-proof'};
  await f.request('/says', {renderTheme: async(name, {say}) => {
    assert.match(say.html.composer, /data-csrf="request-proof"/);
    assert.equal(say.identity, undefined);
    assert.equal(say.settings, undefined);
    return say.html.composer;
  }});
  f.state.items[1].allowComments = false;
  f.state.neighbors = {previous: null, next: null};
  await f.request('/says/:id', {params: {id: '2'}, renderTheme: async(name, {say}) => {
    assert.equal(say.html.comments, '<p>评论已关闭。</p>');
    assert.deepEqual(say.navigation, {previous: null, next: null});
    return say.html.comments;
  }});
});

test('view model has an explicit content whitelist and never includes a configured map key', () => {
  const model = createSayViewModel({items: [{id: 1, kind: 'location', text: 'place', tags: [],
    latitude: 39, longitude: 116, secret: 'PRIVATE_ROW', options: {private: 'PRIVATE_OPTIONS'}}],
  page: 1, pageSize: 10, total: 1}, {amapKey: 'PRIVATE_MAP', settings: {apiKey: 'PRIVATE_API'}});
  assert.doesNotMatch(JSON.stringify(model), /PRIVATE_/);
  assert.match(model.html.items, /39, 116/);
});
