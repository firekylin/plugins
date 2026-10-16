'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function loadPlugin(row) {
  let route;
  global.think = {
    datetime: () => '2026-10-15 12:00:00',
    model: () => ({
      where() { return this },
      field() { return this },
      setRelation() { return this },
      async find() { return row }
    })
  };
  require('../plugin').register({routes: {register(value) { route = value }}});
  return route;
}

function request(method = 'GET') {
  const headers = {};
  return {
    method,
    set(name, value) { headers[name] = value },
    throw(status, message) { throw Object.assign(new Error(message), {status}) },
    headers
  };
}

test('registers a public site route and serves Markdown response headers', async() => {
  const route = loadPlugin({id: 1, markdown_content: '# Article', options: {}});
  assert.equal(route.path, '/:slug.md');
  assert.equal(route.scope, 'site');
  assert.deepEqual(route.method, ['GET', 'HEAD']);

  const ctx = request();
  assert.equal(await route.handler({ctx, params: {slug: 'article'}}), '# Article');
  assert.equal(ctx.type, 'text/markdown; charset=utf-8');
  assert.equal(ctx.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(ctx.headers['Cache-Control'], 'public, max-age=60');

  const head = request('HEAD');
  assert.equal(await route.handler({ctx: head, params: {slug: 'article'}}), '# Article');
});

test('returns 404 when no eligible article exists', async() => {
  const route = loadPlugin({});
  await assert.rejects(route.handler({ctx: request(), params: {slug: 'missing'}}), {status: 404});
});
