'use strict';

const crypto = require('node:crypto');

const OPTION_KEY = 'plugin_friend_links';
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

  async read() {
    const row = await this.model().where({key: OPTION_KEY}).find();
    return state(row && row.value);
  }

  async write(value) {
    await this.model().updateOptions(OPTION_KEY, JSON.stringify(value));
    return value;
  }

  async settings() { return (await this.read()).settings }

  async saveSettings(values) {
    const current = await this.read();
    current.settings = normalizeSettings(values, current.settings);
    await this.write(current);
    return current.settings;
  }

  async list({page = 1, pageSize, category, keyword, publicOnly = false} = {}) {
    const current = await this.read();
    page = integer(page, 1, 1, 100000);
    pageSize = integer(pageSize, current.settings.pageSize, 1, 200);
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

  async save(input) {
    const current = await this.read();
    const requestedId = String(input.id || '').trim();
    const index = requestedId ? current.links.findIndex(link => link.id === requestedId) : -1;
    if (requestedId && index === -1) throw Object.assign(new Error('Friend link was not found'), {status: 404});
    const existing = index >= 0 ? current.links[index] : {};
    const link = normalizeLink(input, existing, this.now(), this.createId);
    if (current.links.some(item => item.id !== link.id && item.url === link.url)) {
      throw Object.assign(new Error('A friend link with this URL already exists'), {status: 409});
    }
    if (index >= 0) current.links[index] = link;
    else current.links.push(link);
    await this.write(current);
    return link;
  }

  async remove(id) {
    const linkId = String(id || '').trim();
    if (!linkId) throw Object.assign(new Error('Friend link ID is required'), {status: 400});
    const current = await this.read();
    const next = current.links.filter(link => link.id !== linkId);
    if (next.length === current.links.length) throw Object.assign(new Error('Friend link was not found'), {status: 404});
    current.links = next;
    await this.write(current);
    return true;
  }
}

module.exports = {DEFAULT_SETTINGS, FriendLinksService, OPTION_KEY, normalizeLink, normalizeSettings, safeUrl, sortLinks, state};
