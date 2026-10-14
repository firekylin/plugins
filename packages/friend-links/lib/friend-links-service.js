'use strict';

const crypto = require('node:crypto');

const OPTION_KEY = 'plugin_friend_links';
const SETTINGS_KEY = 'plugin_friend_links_settings';
const LINK_PREFIX = 'plugin_friend_links_link_';
const DEFAULT_SETTINGS = Object.freeze({enabled: true, pageSize: 50});
const STATUSES = new Set(['active', 'inactive']);

function parse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback } catch { return fallback }
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function safeUrl(value, label, required = false) {
  const source = String(value || '').trim();
  if (!source && !required) return '';
  let url;
  try { url = new URL(source) } catch { throw Object.assign(new Error(`${label} must be a valid URL`), {status: 400}) }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error(`${label} must use HTTP or HTTPS`), {status: 400});
  }
  return source.slice(0, 2048);
}

function normalizeSettings(value = {}, previous = {}) {
  const prior = {...DEFAULT_SETTINGS, ...previous};
  return {
    enabled: value.enabled !== false,
    pageSize: integer(value.pageSize, prior.pageSize, 1, 200)
  };
}

function normalizeLink(input = {}, existing = {}, now = new Date().toISOString(), createId) {
  const name = String(input.name || '').trim().slice(0, 100);
  if (!name) throw Object.assign(new Error('Link name is required'), {status: 400});
  return {
    id: existing.id || (createId ? createId() : crypto.randomUUID()),
    name,
    url: safeUrl(input.url, 'Link URL', true),
    avatar: safeUrl(input.avatar, 'Avatar URL'),
    description: String(input.description || '').trim().slice(0, 500),
    category: String(input.category || '默认分类').trim().slice(0, 80) || '默认分类',
    status: STATUSES.has(input.status) ? input.status : 'active',
    order: integer(input.order, existing.order || 0, -999999, 999999),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function state(value) {
  const parsed = parse(value);
  return {
    settings: normalizeSettings(parsed.settings),
    links: Array.isArray(parsed.links) ? parsed.links : []
  };
}

function sortLinks(links) {
  return [...links].sort((left, right) =>
    Number(left.order || 0) - Number(right.order || 0) ||
    String(left.name).localeCompare(String(right.name), 'zh-CN') ||
    String(left.id).localeCompare(String(right.id)));
}

class FriendLinksService {
  constructor({getModel, now = () => new Date().toISOString(), createId = () => crypto.randomUUID()}) {
    this.getModel = getModel;
    this.now = now;
    this.createId = createId;
  }

  model() { return this.getModel('options') }

  async options() { return this.model().getOptions(true) }

  async read() {
    const options = await this.options();
    const legacy = state(options[OPTION_KEY]);
    const stored = Object.entries(options).filter(([key]) => key.startsWith(LINK_PREFIX))
      .map(([, value]) => parse(value, null)).filter(link => link && link.id);
    const links = new Map(legacy.links.map(link => [link.id, link]));
    stored.forEach(link => links.set(link.id, link));
    return {
      settings: options[SETTINGS_KEY] ? normalizeSettings(parse(options[SETTINGS_KEY]), legacy.settings) : legacy.settings,
      links: [...links.values()]
    };
  }

  linkKey(id) { return `${LINK_PREFIX}${id}` }

  async ensureMigrated() {
    const options = await this.options();
    const legacy = state(options[OPTION_KEY]);
    if (!legacy.links.length) return;
    const values = options[SETTINGS_KEY] ? {} : {[SETTINGS_KEY]: JSON.stringify(legacy.settings)};
    sortLinks(legacy.links).forEach((link, order) => {
      link.order = order;
      const key = this.linkKey(link.id);
      if (!options[key]) values[key] = JSON.stringify(link);
    });
    if (Object.keys(values).length) await this.model().updateOptions(values);
    await this.model().where({key: OPTION_KEY}).delete();
  }

  async settings() { return (await this.read()).settings }

  async saveSettings(values) {
    const settings = normalizeSettings(values, await this.settings());
    await this.model().updateOptions(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  async list({page = 1, pageSize, category, keyword, publicOnly = false, all = false} = {}) {
    const current = await this.read();
    page = integer(page, 1, 1, 100000);
    pageSize = all === true ? Number.MAX_SAFE_INTEGER : integer(pageSize, current.settings.pageSize, 1, 200);
    let links = current.links;
    if (publicOnly) links = current.settings.enabled ? links.filter(link => link.status === 'active') : [];
    if (category) links = links.filter(link => link.category === String(category));
    const query = String(keyword || '').trim().toLowerCase();
    if (query) links = links.filter(link => [link.name, link.url, link.description, link.category]
      .some(value => String(value || '').toLowerCase().includes(query)));
    links = sortLinks(links);
    const total = links.length;
    return {page, pageSize, total, items: links.slice((page - 1) * pageSize, page * pageSize)};
  }

  async get(id) {
    const link = (await this.read()).links.find(item => item.id === String(id || '').trim());
    if (!link) throw Object.assign(new Error('Friend link was not found'), {status: 404});
    return link;
  }

  async save(input) {
    await this.ensureMigrated();
    const current = await this.read();
    const requestedId = String(input.id || '').trim();
    const index = requestedId ? current.links.findIndex(link => link.id === requestedId) : -1;
    if (requestedId && index === -1) throw Object.assign(new Error('Friend link was not found'), {status: 404});
    const existing = index >= 0 ? current.links[index] : {
      order: current.links.reduce((maximum, link) => Math.max(maximum, Number(link.order || 0)), -1) + 1
    };
    const link = normalizeLink(input, existing, this.now(), this.createId);
    if (current.links.some(item => item.id !== link.id && item.url === link.url)) {
      throw Object.assign(new Error('A friend link with this URL already exists'), {status: 409});
    }
    await this.model().updateOptions(this.linkKey(link.id), JSON.stringify(link));
    return link;
  }

  async remove(id) {
    await this.ensureMigrated();
    const linkId = String(id || '').trim();
    if (!linkId) throw Object.assign(new Error('Friend link ID is required'), {status: 400});
    const current = await this.read();
    if (!current.links.some(link => link.id === linkId)) throw Object.assign(new Error('Friend link was not found'), {status: 404});
    await this.model().where({key: this.linkKey(linkId)}).delete();
    return true;
  }

  async move(id, direction) {
    await this.ensureMigrated();
    if (!['up', 'down'].includes(direction)) throw Object.assign(new Error('Invalid move direction'), {status: 400});
    const current = await this.read();
    const links = sortLinks(current.links);
    const index = links.findIndex(link => link.id === String(id || '').trim());
    if (index === -1) throw Object.assign(new Error('Friend link was not found'), {status: 404});
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= links.length) return false;
    const currentOrder = links[index].order;
    links[index].order = links[target].order;
    links[target].order = currentOrder;
    await this.model().updateOptions({
      [this.linkKey(links[index].id)]: JSON.stringify(links[index]),
      [this.linkKey(links[target].id)]: JSON.stringify(links[target])
    });
    return true;
  }
}

module.exports = {DEFAULT_SETTINGS, FriendLinksService, LINK_PREFIX, OPTION_KEY, SETTINGS_KEY,
  normalizeLink, normalizeSettings, safeUrl, sortLinks, state};
