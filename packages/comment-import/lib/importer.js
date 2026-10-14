'use strict';

const crypto = require('node:crypto');
const {parse, SUPPORTED_SOURCES} = require('./adapters');

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_COMMENTS = 50000;

function parseJson(value, label, fallback, allowJsonLines = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  if (Buffer.byteLength(value) > MAX_INPUT_BYTES) throw new Error(`${label} exceeds 8 MiB`);
  try {
    return JSON.parse(value);
  } catch (error) {
    if (allowJsonLines) {
      try {
        const rows = value.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
        if (rows.length) return rows;
      } catch (jsonLinesError) {
        throw new Error(`${label} is not valid JSON or JSON Lines: ${jsonLinesError.message}`);
      }
    }
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function text(value, maximum) {
  return String(value || '').replace(/\0/g, '').slice(0, maximum);
}

function status(value, fallback) {
  if (value === true) return 'approved';
  if (value === false) return 'waiting';
  const normalized = String(value || '').toLowerCase();
  if (['approved', 'published', 'normal', 'visible', 'active', 'ok'].includes(normalized)) return 'approved';
  if (['waiting', 'pending', 'unapproved', 'moderating', 'pending_review'].includes(normalized)) return 'waiting';
  if (['spam', 'collapsed', 'hidden'].includes(normalized)) return 'spam';
  if (['deleted', 'removed'].includes(normalized)) return null;
  return fallback;
}

function normalizeRoute(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return {id: value};
  let route = String(value || '').trim();
  if (!route) return null;
  if (/^https?:\/\//i.test(route)) {
    try { route = new URL(route).pathname } catch (error) { return null }
  }
  if (!route.startsWith('/')) route = '/' + route;
  route = route.replace(/\?.*$/, '').replace(/#.*$/, '');
  const match = route.match(/^\/(post|page)\/(.+?)(?:\.html)?\/?$/i);
  if (!match) return null;
  try {
    return {type: match[1].toLowerCase() === 'page' ? 1 : 0,
      pathname: decodeURIComponent(match[2].replace(/\.html$/i, '')),
      url: `/${match[1].toLowerCase()}/${match[2].replace(/\.html$/i, '')}.html`};
  } catch (error) { return null }
}

function targetFor(comment, pageMap) {
  const keys = [...(comment.threadKeys || []), comment.url, comment.sourceId].filter(Boolean).map(String);
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(pageMap, key)) return normalizeRoute(pageMap[key]);
  return normalizeRoute(comment.url);
}

function datetime(value, now) {
  if (!value) return now();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? now() : parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function fingerprint(row) {
  const inserted = String(row.inserted_at || '').replace('T', ' ').slice(0, 19);
  return crypto.createHash('sha256').update([
    row.post_id, row.url, row.nick || '', row.mail || '', row.comment, inserted
  ].join('\0')).digest('hex');
}

class CommentImporter {
  constructor({getModel, now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')}) {
    if (typeof getModel !== 'function') throw new TypeError('getModel is required');
    this.getModel = getModel;
    this.now = now;
  }

  async posts() {
    const rows = await this.getModel('post').where({type: ['IN', [0, 1]]})
      .field('id,type,pathname').setRelation(false).select();
    return {
      byId: new Map(rows.map(row => [Number(row.id), row])),
      byPath: new Map(rows.map(row => [`${Number(row.type)}:${row.pathname}`, row]))
    };
  }

  async existingFingerprints() {
    const rows = await this.getModel('comment')
      .field('id,post_id,url,nick,mail,comment,inserted_at').select();
    return new Map(rows.map(row => [fingerprint(row), row.id]));
  }

  prepare({source, data, pageMap = {}, defaultStatus = 'approved'}, posts) {
    if (!SUPPORTED_SOURCES.has(source)) throw new Error(`Unsupported comment source: ${source}`);
    const parsed = parse(source, parseJson(data, 'Comment data', [], true));
    const mappings = parseJson(pageMap, 'Page map', {});
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw new Error('Page map must be an object');
    if (parsed.length > MAX_COMMENTS) throw new Error(`A single import is limited to ${MAX_COMMENTS} comments`);
    const fallbackStatus = status(defaultStatus, 'approved') || 'approved';
    const skipped = {invalid: 0, deleted: 0, unmatched: 0};
    const rows = [];
    const sourceIds = new Set();
    for (const item of parsed) {
      const commentStatus = status(item.status, fallbackStatus);
      if (!commentStatus) { skipped.deleted += 1; continue }
      if (!item.content.trim()) { skipped.invalid += 1; continue }
      const target = targetFor(item, mappings);
      const post = target && (target.id ? posts.byId.get(target.id) : posts.byPath.get(`${target.type}:${target.pathname}`));
      if (!post) { skipped.unmatched += 1; continue }
      const url = target.url || `/${Number(post.type) === 1 ? 'page' : 'post'}/${post.pathname}.html`;
      let sourceId = text(item.sourceId, 191);
      if (!sourceId || sourceIds.has(sourceId)) sourceId = `generated:${rows.length}:${fingerprint({
        post_id: post.id, url, nick: item.nick, mail: item.mail, comment: item.content,
        inserted_at: item.insertedAt || item.createdAt || ''
      })}`;
      sourceIds.add(sourceId);
      const inserted = datetime(item.insertedAt || item.createdAt, this.now);
      rows.push({
        sourceId,
        parentId: text(item.parentId, 191),
        rootId: text(item.rootId, 191),
        data: {
          post_id: Number(post.id), url, comment: text(item.content, 1000000),
          mail: text(item.mail, 255) || null, nick: text(item.nick || 'Anonymous', 255),
          link: text(item.link, 512) || null, pid: null, rid: null,
          ua: text(item.ua, 4096), ip: text(item.ip, 64), user_id: null,
          status: commentStatus, sticky: 0,
          like: Math.max(0, Math.trunc(Number(item.like) || 0)),
          inserted_at: inserted,
          created_at: datetime(item.createdAt, () => inserted),
          updated_at: datetime(item.updatedAt, () => inserted)
        }
      });
    }
    const rowsBySourceId = new Map(rows.map(row => [row.sourceId, row]));
    for (const row of rows) {
      if (!row.parentId || row.rootId) continue;
      let ancestorId = row.parentId;
      const visited = new Set([row.sourceId]);
      let cyclic = false;
      while (rowsBySourceId.has(ancestorId) && !visited.has(ancestorId)) {
        visited.add(ancestorId);
        const ancestor = rowsBySourceId.get(ancestorId);
        if (!ancestor.parentId) break;
        ancestorId = ancestor.parentId;
      }
      if (visited.has(ancestorId) && rowsBySourceId.get(ancestorId)?.parentId) cyclic = true;
      if (!cyclic) row.rootId = ancestorId;
    }
    return {rows, parsed: parsed.length, skipped};
  }

  async run(options) {
    const posts = await this.posts();
    const prepared = this.prepare(options, posts);
    const result = {
      source: options.source, parsed: prepared.parsed, imported: 0, duplicates: 0,
      skipped: prepared.skipped, unresolvedParents: 0, affectedPosts: 0,
      dryRun: options.dryRun === true
    };
    if (result.dryRun) return {...result, importable: prepared.rows.length};
    const existing = await this.existingFingerprints();
    const pending = [...prepared.rows];
    const importedIds = new Map();
    const affectedPosts = new Set();
    while (pending.length) {
      let progress = false;
      for (let index = pending.length - 1; index >= 0; index--) {
        const item = pending[index];
        const parent = item.parentId && importedIds.get(item.parentId);
        const root = item.rootId && importedIds.get(item.rootId);
        const blocked = [item.parentId, item.rootId].filter(Boolean)
          .some(id => !importedIds.has(id) && pending.some(candidate => candidate.sourceId === id));
        if (blocked) continue;
        const row = {...item.data, pid: parent ? String(parent) : null, rid: root ? String(root) : null};
        const key = fingerprint(row);
        if (existing.has(key)) {
          result.duplicates += 1;
          importedIds.set(item.sourceId, existing.get(key));
        } else {
          if (item.unresolved || (item.parentId && !parent) || (item.rootId && !root)) {
            result.unresolvedParents += 1;
          }
          const id = await this.getModel('comment').add(row);
          importedIds.set(item.sourceId, id);
          existing.set(key, id);
          affectedPosts.add(row.post_id);
          result.imported += 1;
        }
        pending.splice(index, 1);
        progress = true;
      }
      if (!progress) {
        pending.forEach(item => { item.parentId = ''; item.rootId = ''; item.unresolved = true });
      }
    }
    for (const postId of affectedPosts) {
      const count = await this.getModel('comment').where({
        post_id: postId, status: ['NOT IN', ['waiting', 'spam']]
      }).count();
      await this.getModel('post').where({id: postId}).update({comment_num: Number(count)});
    }
    result.affectedPosts = affectedPosts.size;
    return result;
  }
}

module.exports = {CommentImporter, normalizeRoute, status, fingerprint, parseJson};
