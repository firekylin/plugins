'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {CommentImporter, canonicalPath} = require('../lib/importer');

class PostModel {
  constructor() { this.rows = [{id: 10, type: 0, title: 'Hello', pathname: 'hello'}, {id: 11, type: 1, title: 'About', pathname: 'about'}]; this.updates = [] }
  setRelation() { return this }
  field() { return this }
  select() { return Promise.resolve(this.rows) }
  where(query) { this.query = query; return this }
  update(data) { this.updates.push({query: this.query, data}); return Promise.resolve(1) }
}

class CommentModel {
  constructor() { this.rows = []; this.added = [] }
  where(query) { this.query = query; return this }
  field() { return this }
  select() { return Promise.resolve(this.rows) }
  add(row) { const id = this.added.length + 100; this.added.push({...row, id}); return Promise.resolve(id) }
  count() { return Promise.resolve(this.added.filter(row => Number(row.post_id) === Number(this.query.post_id) && !['waiting', 'spam'].includes(row.status)).length) }
}

function setup() {
  const models = {post: new PostModel(), comment: new CommentModel()};
  return {models, importer: new CommentImporter({getModel: name => models[name], now: () => new Date('2024-01-03T00:00:00Z')})};
}

test('canonicalPath accepts full and Firekylin URLs', () => {
  assert.equal(canonicalPath('https://blog.test/post/hello.html?x=1'), 'post/hello');
  assert.equal(canonicalPath('/page/about.html'), 'page/about');
});

test('preview matches by route, slug, title and manual map', async () => {
  const {importer} = setup();
  const comments = [
    {sourceId: '1', content: 'a', url: 'https://old.test/post/hello.html', title: '', status: 'approved'},
    {sourceId: '2', content: 'b', url: '/old-about', title: 'About', status: 'approved'},
    {sourceId: '3', content: 'c', url: '/legacy', title: '', status: 'approved'}
  ];
  const result = await importer.preview(comments, {urlMap: {'/legacy': 10}});
  assert.equal(result.matched, 3);
  assert.equal(result.unmatched, 0);
});

test('run writes parents before replies and syncs counts', async () => {
  const {models, importer} = setup();
  const comments = [
    {sourceId: 'reply', parentId: 'root', content: 'reply', url: '/post/hello.html', author: 'B', email: '', status: 'approved', createdAt: '2024-01-02'},
    {sourceId: 'root', parentId: '', content: 'root', url: '/post/hello.html', author: 'A', email: '', status: 'approved', createdAt: '2024-01-01'}
  ];
  const result = await importer.run(comments);
  assert.equal(result.imported, 2);
  assert.equal(models.comment.added[0].comment, 'root');
  assert.equal(models.comment.added[1].pid, '100');
  assert.equal(models.comment.added[1].rid, '100');
  assert.deepEqual(models.post.updates[0].data, {comment_num: 2});
});

test('run skips comments already present', async () => {
  const {models, importer} = setup();
  models.comment.rows.push({post_id: 10, comment: 'same', mail: 'a@example.com', nick: 'A', inserted_at: '2024-01-01 00:00:00'});
  const result = await importer.run([{sourceId: '1', content: 'same', url: '/post/hello.html', author: 'A', email: 'a@example.com', status: 'approved', createdAt: '2024-01-01'}]);
  assert.equal(result.imported, 0);
  assert.equal(result.duplicates, 1);
});
