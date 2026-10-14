'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SAY_TYPE,
  SayService,
  mergeData,
  normalize,
  normalizeSettings,
  secureEqual,
  tags
} = require('../lib/say-service');
const {renderSayPage} = require('../lib/render');

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (Array.isArray(expected) && expected[0] === 'IN') return expected[1].map(Number).includes(Number(row[key]));
    return Number.isFinite(Number(expected)) && expected !== '' ? Number(row[key]) === Number(expected) : row[key] === expected;
  });
}

function fixture() {
  const rows = [];
  const options = new Map();
  let nextId = 1;
  class PostModel {
    setRelation() { return this }
    where(value) { this.condition = value; return this }
    order(value) { this.orderValue = value; return this }
    limit() { return this }
    async select() {
      const direction = /ASC/i.test(this.orderValue || '') ? 1 : -1;
      const selected = rows.filter(row => matches(row, this.condition)).sort((a, b) => direction * (a.id - b.id));
      this.condition = null;
      this.orderValue = null;
      return selected.map(row => ({...row}));
    }
    async find() {
      const row = rows.find(item => matches(item, this.condition));
      this.condition = null;
      return row ? {...row} : {};
    }
    async update(value) {
      const selected = rows.filter(row => matches(row, this.condition));
      selected.forEach(row => Object.assign(row, value));
      this.condition = null;
      return selected.length;
    }
    async addPost(value) { const row = {...value, id: nextId++}; rows.push(row); return row.id }
    async savePost(value) {
      const row = rows.find(item => Number(item.id) === Number(value.id));
      Object.assign(row, value);
      return 1;
    }
    async deletePost(id) {
      const index = rows.findIndex(row => Number(row.id) === Number(id) && row.type === SAY_TYPE);
      if (index === -1) return 0;
      rows.splice(index, 1);
      return 1;
    }
  }
  const post = new PostModel();
  const option = {
    where(value) { this.key = value.key; return this },
    async find() { return options.has(this.key) ? {key: this.key, value: options.get(this.key)} : {} },
    async updateOptions(key, value) { options.set(key, value) }
  };
  return {rows, service: new SayService({getModel: name => name === 'post' ? post : option,
    now: () => '2026-10-14 12:00:00'})};
}

test('normalizes content, tags, URLs and settings', () => {
  assert.deepEqual(tags('one, #two', 'hello #two #三'), ['one', 'two', '三']);
  const item = normalize({kind: 'textpic', status: 'private', text: 'Hi #tag',
    images: '["https://example.test/a.jpg"]'});
  assert.equal(item.kind, 'textpic');
  assert.deepEqual(item.tags, ['tag']);
  assert.equal(item.images[0], 'https://example.test/a.jpg');
  assert.throws(() => normalize({kind: 'image', images: 'file:///etc/passwd'}), /HTTP or HTTPS/);
  assert.deepEqual(normalizeSettings({pageSize: 999, apiKey: ''}, {apiKey: 'keep'}),
    {enabled: true, pageSize: 100, apiKey: 'keep', authorId: 1, amapKey: '', wecomCorpId: '',
      wecomCorpSecret: '', wecomToken: '', wecomEncodingAESKey: ''});
  assert.throws(() => normalizeSettings({apiKey: 'short'}), /at least 16/);
  assert.throws(() => normalizeSettings({wecomEncodingAESKey: 'short'}), /43 characters/);
});

test('creates isolated type-3 records and only exposes public says', async() => {
  const {rows, service} = fixture();
  const first = await service.create({kind: 'text', text: 'Public #news', status: 'public'}, 7);
  await service.create({kind: 'text', text: 'Secret', status: 'private'}, 7);
  assert.equal(first.id, 1);
  assert.equal(rows[0].type, SAY_TYPE);
  assert.equal(rows[0].user_id, 7);
  const result = await service.list({publicOnly: true, tag: 'news'});
  assert.equal(result.total, 1);
  assert.equal(result.items[0].text, 'Public #news');
});

test('updates status, deletes records and retains unrelated post types', async() => {
  const {rows, service} = fixture();
  await service.create({text: 'One'}, 1);
  await service.create({text: 'Two'}, 1);
  rows.push({id: 99, type: 0});
  await service.updateStatus('1,2', 'hidden');
  assert.equal((await service.list({status: 'hidden'})).total, 2);
  assert.equal(await service.remove('1,99'), 1);
  assert.equal(rows.some(row => row.id === 99), true);
});

test('gets, edits and duplicates individual says', async() => {
  const {service} = fixture();
  await service.create({kind: 'text', text: 'Original', status: 'public'}, 1);
  const edited = await service.update(1, {kind: 'text', text: 'Edited #tag', status: 'private'});
  assert.equal(edited.text, 'Edited #tag');
  assert.equal(edited.status, 'private');
  assert.deepEqual(edited.tags, ['tag']);
  const copy = await service.duplicate(1, 9);
  assert.equal(copy.id, 2);
  assert.equal(copy.text, 'Edited #tag');
  await assert.rejects(service.get(999), /not found/);
});

test('merges compatible say types', async() => {
  const merged = mergeData([
    {kind: 'text', text: 'caption', status: 'public', tags: ['one']},
    {kind: 'image', images: ['https://example.test/a.jpg'], status: 'public', tags: ['two']}
  ]);
  assert.equal(merged.kind, 'textpic');
  assert.equal(merged.text, 'caption');
  assert.deepEqual(merged.tags, ['one', 'two']);
  assert.throws(() => mergeData([{kind: 'text'}, {kind: 'text'}]), /merge rule/);

  const {service} = fixture();
  await service.create({kind: 'text', text: 'caption'}, 1);
  await service.create({kind: 'image', images: 'https://example.test/a.jpg'}, 1);
  const result = await service.merge('1,2');
  assert.equal(result.id, 1);
  assert.equal((await service.list()).total, 1);
  assert.equal((await service.list()).items[0].kind, 'textpic');
});

test('compares API keys safely and escapes the standalone page', () => {
  assert.equal(secureEqual('secret', 'secret'), true);
  assert.equal(secureEqual('secret', 'other'), false);
  const html = renderSayPage({page: 1, pageSize: 10, total: 1, items: [{kind: 'text',
    text: '<script>alert(1)</script>', tags: ['x'], createdAt: 'now'}]}, {title: 'Site'});
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
