'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {parse, platforms} = require('../lib/adapters');

const fixtures = {
  valine: {Comment: [{objectId: 'v1', comment: 'V', url: '/post/hello.html', nick: 'A', createdAt: '2024-01-01'}]},
  waline: [{id: 1, comment: 'W', url: '/post/hello.html', nick: 'A', insertedAt: '2024-01-01'}],
  twikoo: {comments: [{_id: 't1', comment: 'T', url: '/post/hello.html', nick: 'A', created: 1704067200000}]},
  artalk: {comments: [{id: 2, content: 'A', page_key: '/post/hello.html', nick: 'A', is_pending: 'false', is_collapsed: 'false', vote_up: 4, created_at: '2024-01-01'}]},
  gitalk: {issues: [{pathname: '/post/hello.html', comments: [{id: 3, body: 'G', user: {login: 'A'}, created_at: '2024-01-01'}]}]},
  giscus: {data: {repository: {discussions: {nodes: [{pathname: '/post/hello.html', comments: {nodes: [{id: 'g1', body: 'G', author: {login: 'A'}, createdAt: '2024-01-01', replies: {nodes: []}}]}}]}}}},
  commento: {commenters: [{commenterHex: 'u1', name: 'A'}], comments: [{commentHex: 'c1', commenterHex: 'u1', markdown: 'C', pageId: '/post/hello.html', creationDate: '2024-01-01'}]}
};

test('all advertised adapters normalize their common export shape', () => {
  assert.deepEqual(platforms.sort(), Object.keys(fixtures).sort());
  for (const [platform, fixture] of Object.entries(fixtures)) {
    const [comment] = parse(platform, JSON.stringify(fixture));
    assert.ok(comment, platform);
    assert.equal(comment.url, '/post/hello.html', platform);
    assert.ok(comment.content, platform);
    assert.equal(comment.author, 'A', platform);
    assert.equal(comment.status, 'approved', platform);
  }
  assert.equal(parse('artalk', fixtures.artalk)[0].like, 4);
});

test('giscus preserves nested reply relationship', () => {
  const fixture = fixtures.giscus;
  fixture.data.repository.discussions.nodes[0].comments.nodes[0].replies.nodes.push({id: 'g2', body: 'reply', createdAt: '2024-01-02'});
  const comments = parse('giscus', fixture);
  assert.equal(comments.length, 2);
  assert.equal(comments[1].parentId, 'g1');
  assert.equal(comments[1].rootId, 'g1');
});

test('JSON Lines input is accepted', () => {
  const comments = parse('waline', '{"id":1,"comment":"one","url":"/a"}\n{"id":2,"comment":"two","url":"/b"}');
  assert.equal(comments.length, 2);
});
