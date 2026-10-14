'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RelatedPostService,
  injectRelatedPosts,
  normalizeSettings,
  renderRelatedPosts
} = require('../lib/related-post-service');

function matches(row, where) {
  return Object.entries(where || {}).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (Object.hasOwn(expected, '<=')) return String(row[key]) <= String(expected['<=']);
    }
    if (Array.isArray(expected)) {
      if (expected[0] === 'IN') return expected[1].map(Number).includes(Number(row[key]));
      if (expected[0] === '!=') return Number(row[key]) !== Number(expected[1]);
    }
    return row[key] === expected;
  });
}

function query(rows) {
  let where = {};
  let maximum = Infinity;
  let newestFirst = false;
  const chain = {
    setRelation() { return chain },
    where(value) { where = value; return chain },
    field() { return chain },
    order(value) { newestFirst = value === 'create_time DESC'; return chain },
    limit(value) { maximum = value; return chain },
    async find() { return rows.find(row => matches(row, where)) || {} },
    async select() {
      const result = rows.filter(row => matches(row, where));
      if (newestFirst) result.sort((left, right) => String(right.create_time).localeCompare(String(left.create_time)));
      return result.slice(0, maximum);
    }
  };
  return chain;
}

function serviceFor(data) {
  return new RelatedPostService({
    getModel: name => query(data[name] || []),
    now: () => '2026-10-14 00:00:00'
  });
}

test('normalizes settings into supported bounds', () => {
  assert.deepEqual(normalizeSettings({title: '  Picks  ', limit: 99, tagWeight: -2}), {
    enabled: true,
    title: 'Picks',
    limit: 20,
    tagWeight: 0,
    categoryWeight: 1,
    fallback: true,
    autoInject: true
  });
});

test('ranks matching public posts and hides protected content', async() => {
  const service = serviceFor({
    post_tag: [
      {post_id: 1, tag_id: 10}, {post_id: 2, tag_id: 10},
      {post_id: 4, tag_id: 10}, {post_id: 5, tag_id: 10}
    ],
    post_cate: [
      {post_id: 1, cate_id: 20}, {post_id: 3, cate_id: 20}, {post_id: 4, cate_id: 20}
    ],
    post: [
      {id: 2, title: 'Tag match', pathname: 'tag', type: 0, status: 3, is_public: 1,
        create_time: '2026-01-01 00:00:00', options: '{}'},
      {id: 3, title: 'Category match', pathname: 'category', type: 0, status: 3, is_public: 1,
        create_time: '2026-09-01 00:00:00', options: '{}'},
      {id: 4, title: 'Secret', pathname: 'secret', type: 0, status: 3, is_public: 1,
        create_time: '2026-10-01 00:00:00', options: '{"postPasswordHash":"hash"}'},
      {id: 5, title: 'Draft', pathname: 'draft', type: 0, status: 0, is_public: 1,
        create_time: '2026-10-01 00:00:00', options: '{}'}
    ]
  });

  const posts = await service.find({id: 1, tag: [{id: 10}], cate: [{id: 20}]}, {limit: 5});
  assert.deepEqual(posts.map(post => post.id), [2, 3]);
});

test('falls back to recent posts when no taxonomy matches', async() => {
  const service = serviceFor({
    post_tag: [],
    post_cate: [],
    post: [
      {id: 1, title: 'Current', pathname: 'current', type: 0, status: 3, is_public: 1,
        create_time: '2026-01-01 00:00:00'},
      {id: 2, title: 'Older', pathname: 'older', type: 0, status: 3, is_public: 1,
        create_time: '2026-02-01 00:00:00'},
      {id: 3, title: 'Newer', pathname: 'newer', type: 0, status: 3, is_public: 1,
        create_time: '2026-03-01 00:00:00'}
    ]
  });

  const posts = await service.find({id: 1}, {limit: 1});
  assert.deepEqual(posts.map(post => post.id), [3]);
});

test('renders escaped links and injects them only once', () => {
  const html = renderRelatedPosts([{title: '<script>', pathname: 'hello world'}], 'You & me');
  assert.match(html, /You &amp; me/);
  assert.match(html, /hello%20world/);
  assert.match(html, /&lt;script&gt;/);

  const page = '<main><div id="comments"></div></main>';
  const injected = injectRelatedPosts(page, html);
  assert.ok(injected.indexOf(html) < injected.indexOf('id="comments"'));
  assert.equal(injectRelatedPosts(injected, html), injected);
});
