'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {parse, parseUsers} = require('../lib/adapters');

const cases = {
  waline: {results: [{objectId: 'w1', comment: 'Waline', url: '/post/hello.html', nick: 'W'}]},
  valine: [{objectId: 'v1', comment: 'Valine', url: '/post/hello.html', nick: 'V',
    createdAt: {iso: '2024-01-01T00:00:00.000Z'}}],
  artalk: [{id: '3', rid: '0', content: 'Artalk', page_key: '/post/hello.html',
    nick: 'A', is_pending: 'true', vote_up: '2'}],
  twikoo: [{_id: {$oid: 't1'}, comment: '<strong>Twikoo</strong>', url: '/post/hello.html', nick: 'T',
    isSpam: true, like: ['user-1', 'user-2'], created: {$date: '2024-01-02T00:00:00.000Z'}}],
  gitalk: {issues: [{id: 5, number: 7, title: 'Gitalk thread', url: 'https://api.github.test/issues/7'}],
    comments: [{id: 6, issue_url: 'https://api.github.test/issues/7', body: 'Gitalk',
      user: {login: 'G', html_url: 'https://github.test/G'}}]},
  giscus: {data: {repository: {discussions: {nodes: [{id: 'd1', number: 8, title: 'Giscus thread',
    comments: {nodes: [{id: 'gc1', body: 'Giscus', author: {login: 'C'}, replies: {nodes: [
      {id: 'gr1', body: 'Reply', author: {login: 'R'}}
    ]}}]}}]}}}},
  commento: {version: 1, commenters: [{commenterHex: 'u1', name: 'C', email: 'c@example.test',
    link: 'https://example.test'}], comments: [{commentHex: 'c1', commenterHex: 'u1', parentHex: 'root',
    markdown: 'Commento', url: '/post/hello.html', creationDate: '2024-01-03T00:00:00Z'}]}
};

for (const [source, input] of Object.entries(cases)) {
  test(`normalizes ${source} exports`, () => {
    const comments = parse(source, input);
    assert.ok(comments.length > 0);
    assert.ok(comments[0].sourceId);
    assert.ok(comments[0].content);
    if (source === 'gitalk' || source === 'giscus') assert.ok(comments[0].threadKeys.length);
  });
}

test('keeps Giscus nested reply relationships', () => {
  const comments = parse('giscus', cases.giscus);
  assert.equal(comments.length, 2);
  assert.equal(comments[1].parentId, 'gc1');
});

test('maps source-specific status, identity and content fields', () => {
  assert.equal(parse('artalk', cases.artalk)[0].status, 'waiting');
  const twikoo = parse('twikoo', cases.twikoo)[0];
  assert.equal(twikoo.content, '**Twikoo**');
  assert.equal(twikoo.status, 'spam');
  assert.equal(twikoo.like, 2);
  const commento = parse('commento', cases.commento)[0];
  assert.equal(commento.nick, 'C');
  assert.equal(commento.mail, 'c@example.test');
  assert.equal(commento.parentId, '');
});

test('rejects unknown source formats', () => {
  assert.throws(() => parse('unknown', []), /Unsupported/);
});

test('normalizes users from an official Waline database backup', () => {
  const input = {data: {Users: [{objectId: 'u1', email: ' User@Example.Test ', display_name: 'User',
    github: 'octocat', password: 'hash', '2fa': 'secret'}], Comment: []}};
  assert.deepEqual(parseUsers('waline', input), [{
    sourceId: 'u1', email: 'user@example.test', displayName: 'User', url: '', avatar: '', label: '',
    createdAt: undefined, socials: [{provider: 'github', accountId: 'octocat'}]
  }]);
  assert.deepEqual(parseUsers('valine', input), []);
});
