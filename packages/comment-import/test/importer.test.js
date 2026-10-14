'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {CommentImporter, normalizeRoute, status} = require('../lib/importer');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (Array.isArray(expected)) {
      const operator = String(expected[0]).toUpperCase();
      if (operator === 'IN') return expected[1].map(String).includes(String(row[key]));
      if (operator === 'NOT IN') return !expected[1].map(String).includes(String(row[key]));
    }
    return String(row[key]) === String(expected);
  });
}

function database() {
  const tables = {
    post: [{id: 10, type: 0, pathname: 'hello', comment_num: 0},
      {id: 11, type: 1, pathname: 'about', comment_num: 0}],
    comment: [],
    user: [],
    user_social: []
  };
  let nextId = 1;
  class Query {
    constructor(name, condition = {}) { this.name = name; this.condition = condition }
    where(condition) { return new Query(this.name, {...this.condition, ...condition}) }
    field() { return this }
    setRelation() { return this }
    async select() { return tables[this.name].filter(row => matches(row, this.condition)).map(row => ({...row})) }
    async count() { return tables[this.name].filter(row => matches(row, this.condition)).length }
    async add(row) { const id = nextId++; tables[this.name].push({...row, id}); return id }
    async update(patch) {
      let count = 0;
      tables[this.name].forEach(row => {
        if (matches(row, this.condition)) { Object.assign(row, patch); count += 1 }
      });
      return count;
    }
  }
  return {tables, getModel: name => new Query(name)};
}

function exportData() {
  return JSON.stringify({results: [
    {objectId: 'parent', comment: 'Parent', url: '/post/hello.html', nick: 'Alice',
      mail: 'alice@example.test', status: 'approved', insertedAt: '2024-01-01T00:00:00Z'},
    {objectId: 'child', pid: 'parent', rid: 'parent', comment: 'Child', url: '/post/hello.html',
      nick: 'Bob', status: 'waiting', insertedAt: '2024-01-02T00:00:00Z'},
    {objectId: 'missing', comment: 'No target', url: '/post/missing.html', nick: 'Nobody'}
  ]});
}

test('imports comments, relationships and counts, then skips duplicates', async() => {
  const db = database();
  const importer = new CommentImporter({getModel: db.getModel, now: () => '2024-02-01 00:00:00'});
  const first = await importer.run({source: 'waline', data: exportData(), pageMap: '{}', defaultStatus: 'approved'});
  assert.deepEqual(first, {source: 'waline', parsed: 3, imported: 2, duplicates: 0,
    skipped: {invalid: 0, deleted: 0, unmatched: 1}, unresolvedParents: 0, affectedPosts: 1, dryRun: false,
    users: {created: 0, matched: 0, skipped: 0, socialLinked: 0, socialConflicts: 0}});
  assert.equal(db.tables.comment.length, 2);
  assert.equal(db.tables.comment[1].pid, String(db.tables.comment[0].id));
  assert.equal(db.tables.comment[1].rid, String(db.tables.comment[0].id));
  assert.equal(db.tables.post[0].comment_num, 1);

  db.tables.post[0].comment_num = 0;
  const second = await importer.run({source: 'waline', data: exportData(), pageMap: '{}', defaultStatus: 'approved'});
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(second.affectedPosts, 1);
  assert.equal(db.tables.post[0].comment_num, 1);
  assert.equal(db.tables.comment.length, 2);
});

test('previews page mappings without writing', async() => {
  const db = database();
  const importer = new CommentImporter({getModel: db.getModel});
  const result = await importer.run({source: 'gitalk', dryRun: true,
    data: JSON.stringify({issues: [{number: 22, title: 'Thread', comments: [
      {id: 1, body: 'Mapped Gitalk comment', user: {login: 'octocat'}}
    ]}]}), pageMap: JSON.stringify({'22': 11}), defaultStatus: 'approved'});
  assert.equal(result.importable, 1);
  assert.equal(result.skipped.unmatched, 0);
  assert.equal(db.tables.comment.length, 0);
});

test('accepts LeanCloud JSON Lines exports', async() => {
  const db = database();
  const importer = new CommentImporter({getModel: db.getModel});
  const data = [
    {objectId: 'line-1', comment: 'First line', url: '/post/hello.html'},
    {objectId: 'line-2', comment: 'Second line', url: '/post/hello.html'}
  ].map(row => JSON.stringify(row)).join('\n');
  const result = await importer.run({source: 'valine', data, pageMap: '{}',
    defaultStatus: 'approved', dryRun: true});
  assert.equal(result.parsed, 2);
  assert.equal(result.importable, 2);
});

test('imports and matches Waline users, social identities and comment ownership', async() => {
  const db = database();
  db.tables.user.push({id: 20, name: 'existing', display_name: 'Existing', email: 'existing@example.test'});
  db.tables.user_social.push({id: 1, user_id: 20, provider: 'github', account_id: 'existing-gh'});
  const importer = new CommentImporter({getModel: db.getModel, now: () => '2024-02-01 00:00:00'});
  const result = await importer.run({source: 'waline', pageMap: '{}', defaultStatus: 'approved', data: JSON.stringify({
    type: 'waline', data: {
      Users: [
        {objectId: 'wu1', email: ' Existing@Example.Test ', display_name: 'Existing Waline', github: 'existing-gh'},
        {objectId: 'wu2', email: 'new@example.test', display_name: 'New User', url: 'https://example.test',
          avatar: 'https://example.test/avatar.png', github: 'new-gh', gitlab: 42, password: 'do-not-copy', '2fa': 'secret'}
      ],
      Comment: [
        {objectId: 'wc1', user_id: 'wu1', comment: 'Existing user', url: '/post/hello.html'},
        {objectId: 'wc2', user_id: 'wu2', comment: 'New user', url: '/post/hello.html'}
      ]
    }
  })});
  assert.deepEqual(result.users, {created: 1, matched: 1, skipped: 0, socialLinked: 2, socialConflicts: 0});
  const created = db.tables.user.find(user => user.email === 'new@example.test');
  assert.equal(created.type, 4);
  assert.equal(created.password, '');
  assert.equal(created.comment_2fa, null);
  assert.equal(db.tables.comment.find(comment => comment.comment === 'Existing user').user_id, 20);
  assert.equal(db.tables.comment.find(comment => comment.comment === 'New user').user_id, created.id);
  assert.deepEqual(db.tables.user_social.filter(row => row.user_id === created.id)
    .map(row => [row.provider, row.account_id]).sort(), [['github', 'new-gh'], ['gitlab', '42']]);
});

test('imports cyclic replies as top-level comments instead of hanging', async() => {
  const db = database();
  const importer = new CommentImporter({getModel: db.getModel, now: () => '2024-02-01 00:00:00'});
  const result = await importer.run({source: 'twikoo', data: JSON.stringify([
    {_id: 'one', pid: 'two', comment: 'One', url: '/post/hello.html'},
    {_id: 'two', pid: 'one', comment: 'Two', url: '/post/hello.html'}
  ]), pageMap: '{}', defaultStatus: 'approved'});
  assert.equal(result.imported, 2);
  assert.equal(result.unresolvedParents, 2);
  assert.deepEqual(db.tables.comment.map(item => item.pid), [null, null]);
});

test('normalizes only Firekylin post and page routes', () => {
  assert.deepEqual(normalizeRoute('https://blog.test/post/hello.html?x=1'),
    {type: 0, pathname: 'hello', url: '/post/hello.html'});
  assert.deepEqual(normalizeRoute(11), {id: 11});
  assert.equal(normalizeRoute('/archives'), null);
  assert.equal(status('pending', 'approved'), 'waiting');
  assert.equal(status('deleted', 'approved'), null);
});
