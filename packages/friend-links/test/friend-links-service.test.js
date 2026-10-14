'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {FriendLinksService, normalizeLink, normalizeSettings, sortLinks} = require('../lib/friend-links-service');
const {renderFriendLinksPage} = require('../lib/render');
const plugin = require('../plugin');

function fixture(initial = {}) {
  const options = new Map(Object.entries(initial));
  let nextId = 1;
  const model = {
    async getOptions() { return Object.fromEntries(options) },
    where(value) { this.key = value.key; return this },
    async delete() { return options.delete(this.key) ? 1 : 0 },
    async updateOptions(key, value) {
      const values = typeof key === 'object' ? key : {[key]: value};
      Object.entries(values).forEach(([name, item]) => options.set(name, item));
    }
  };
  const service = new FriendLinksService({getModel: () => model, now: () => '2026-10-14 12:00:00', createId: () => `link-${nextId++}`});
  return {service, options};
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
  const {service, options} = fixture();
  const first = await service.save({name: 'A', url: 'https://a.example', category: 'Friends', order: 2});
  await service.save({name: 'B', url: 'https://b.example', category: 'Friends', order: 1, status: 'inactive'});
  assert.equal(first.id, 'link-1');
  assert.equal([...options.keys()].filter(key => key.startsWith('plugin_friend_links_link_')).length, 2);
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

test('appends and moves links without manually entered sort values', async() => {
  const {service} = fixture();
  const first = await service.save({name: 'A', url: 'https://a.example'});
  const second = await service.save({name: 'B', url: 'https://b.example'});
  assert.deepEqual((await service.list()).items.map(link => link.id), [first.id, second.id]);
  assert.equal(await service.move(second.id, 'up'), true);
  assert.deepEqual((await service.list()).items.map(link => link.id), [second.id, first.id]);
  assert.equal(await service.move(second.id, 'up'), false);
  assert.equal((await service.get(first.id)).name, 'A');
});

test('migrates legacy storage without resurrecting deleted links', async() => {
  const legacy = {settings: {enabled: true, pageSize: 25}, links: [
    {id: 'old-1', name: 'Old', url: 'https://old.example', category: '默认分类', status: 'active', order: 0}
  ]};
  const {service, options} = fixture({plugin_friend_links: JSON.stringify(legacy)});
  await service.remove('old-1');
  assert.equal(options.has('plugin_friend_links'), false);
  assert.equal((await service.list()).total, 0);
});

test('stores concurrent creates independently and supports complete admin listings', async() => {
  const {service} = fixture();
  await Promise.all(Array.from({length: 205}, (_, index) => service.save({
    name: `Link ${index}`, url: `https://example.com/${index}`
  })));
  assert.equal((await service.list({pageSize: 200})).items.length, 200);
  assert.equal((await service.list({all: true})).items.length, 205);
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
  const actions = [];
  class Widget {}
  plugin.register({
    widgets: {Widget, register() {}},
    templates: {registerFunction() {}},
    routes: {register() {}},
    admin: {
      registerPanel(value) { panels.push(value) },
      registerPage(value) { pages.push(value) },
      registerForm(value) { forms.push(value) },
      registerAction(value) { actions.push(value) }
    }
  });
  assert.equal(panels[0].icon, 'contact');
  assert.deepEqual(pages.map(page => page.id), ['manage', 'edit', 'settings']);
  assert.deepEqual(forms.map(form => form.page), ['edit', 'settings']);
  assert.deepEqual(actions.map(action => action.id), ['move-link', 'delete-link']);
});
