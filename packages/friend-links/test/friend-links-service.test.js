'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {FriendLinksService, normalizeLink, normalizeSettings, sortLinks} = require('../lib/friend-links-service');
const {renderFriendLinksPage} = require('../lib/render');
const plugin = require('../plugin');

function fixture() {
  let stored = '';
  let nextId = 1;
  const model = {where(value) { this.key = value.key; return this }, async find() { return stored ? {key: this.key, value: stored} : {} },
    async updateOptions(key, value) { stored = value }};
  const service = new FriendLinksService({getModel: () => model, now: () => '2026-10-14 12:00:00', createId: () => `link-${nextId++}`});
  return {service, value: () => JSON.parse(stored)};
}

test('normalizes link fields, settings and ordering', () => {
  const link = normalizeLink({name: ' Example ', url: 'https://example.com', category: '', order: '-2'}, {}, 'now', () => 'id');
  assert.equal(link.name, 'Example');
  assert.equal(link.category, '默认分类');
  assert.equal(link.order, -2);
  assert.throws(() => normalizeLink({name: 'Bad', url: 'javascript:alert(1)'}), /HTTP or HTTPS/);
  assert.deepEqual(normalizeSettings({pageSize: 999}), {enabled: true, pageSize: 200});
  assert.deepEqual(sortLinks([{id: '2', name: 'B', order: 2}, {id: '1', name: 'A', order: 1}]).map(item => item.id), ['1', '2']);
});

test('creates, edits, filters and removes friend links', async() => {
  const {service, value} = fixture();
  const first = await service.save({name: 'A', url: 'https://a.example', category: 'Friends', order: 2});
  await service.save({name: 'B', url: 'https://b.example', category: 'Friends', order: 1, status: 'inactive'});
  assert.equal(first.id, 'link-1');
  assert.equal(value().links.length, 2);
  assert.equal((await service.list({publicOnly: true})).total, 1);
  assert.equal((await service.list({category: 'Friends', keyword: 'a.example'})).items[0].name, 'A');
  const edited = await service.save({...first, name: 'A+'});
  assert.equal(edited.name, 'A+');
  assert.equal(edited.createdAt, first.createdAt);
  await assert.rejects(() => service.save({name: 'Duplicate', url: 'https://a.example'}), /already exists/);
  await service.remove(first.id);
  assert.equal((await service.list()).total, 1);
  await assert.rejects(() => service.remove('missing'), /not found/);
});

test('settings can disable all public results', async() => {
  const {service} = fixture();
  await service.save({name: 'A', url: 'https://a.example'});
  await service.saveSettings({enabled: false, pageSize: 20});
  assert.equal((await service.list({publicOnly: true})).total, 0);
  assert.equal((await service.list()).total, 1);
});

test('standalone page escapes user-controlled content and protects outbound links', () => {
  const html = renderFriendLinksPage([{name: '<script>', url: 'https://example.com/?x=1&y=2', avatar: '', description: 'hello', category: '<friends>'}], {title: 'Links'});
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /x=1&amp;y=2/);
});

test('registers a supported sidebar icon and separate management pages', () => {
  const panels = [];
  const pages = [];
  const forms = [];
  class Widget {}
  plugin.register({
    widgets: {Widget, register() {}},
    templates: {registerFunction() {}},
    routes: {register() {}},
    admin: {
      registerPanel(value) { panels.push(value) },
      registerPage(value) { pages.push(value) },
      registerForm(value) { forms.push(value) }
    }
  });
  assert.equal(panels[0].icon, 'contact');
  assert.deepEqual(pages.map(page => page.id), ['manage', 'settings']);
  assert.deepEqual(forms.map(form => form.page), ['manage', 'manage', 'settings']);
});
