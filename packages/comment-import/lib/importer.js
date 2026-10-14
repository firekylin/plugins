'use strict';

const crypto = require('crypto');

function dateTime(value) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value || ''))) return String(value);
  const date = new Date(value || Date.now());
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return valid.toISOString().slice(0, 19).replace('T', ' ');
}

function canonicalPath(value) {
  let path = String(value || '').trim();
  try { path = new URL(path, 'https://firekylin.invalid').pathname } catch (error) { path = path.split(/[?#]/)[0] }
  try { path = decodeURIComponent(path) } catch (error) { /* retain undecodable source */ }
  return path.replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
}

function pathCandidates(value) {
  const canonical = canonicalPath(value);
  const candidates = new Set([canonical]);
  const match = canonical.match(/^(post|page)\/(.+)$/i);
  if (match) candidates.add(match[2]);
  const pieces = canonical.split('/');
  if (pieces.length > 1) candidates.add(pieces[pieces.length - 1]);
  return [...candidates].filter(Boolean);
}

function inferredType(value) {
  const canonical = canonicalPath(value);
  if (/^page\//i.test(canonical)) return 1;
  if (/^post\//i.test(canonical)) return 0;
  return null;
}

function fingerprint(comment) {
  return crypto.createHash('sha256').update([
    comment.post_id, comment.comment, comment.mail || '', comment.nick || '', comment.inserted_at
  ].join('\u0000')).digest('hex');
}

function depthOf(item, byId, seen = new Set()) {
  if (!item.parentId || !byId.has(item.parentId) || seen.has(item.sourceId)) return 0;
  seen.add(item.sourceId);
  return 1 + depthOf(byId.get(item.parentId), byId, seen);
}

class CommentImporter {
  constructor({getModel, now = () => new Date()} = {}) {
    if (typeof getModel !== 'function') throw new TypeError('getModel is required');
    this.getModel = getModel;
    this.now = now;
  }

  async posts() {
    return this.getModel('post').setRelation(false).field('id,type,title,pathname').select();
  }

  resolve(comments, posts, urlMap = {}) {
    const byPath = new Map();
    const byTitle = new Map();
    for (const post of posts) {
      const key = canonicalPath(post.pathname);
      byPath.set(`${Number(post.type)}:${key}`, post);
      if (!byPath.has(`*:${key}`)) byPath.set(`*:${key}`, post);
      if (post.title && !byTitle.has(post.title)) byTitle.set(post.title, post);
    }
    return comments.map(comment => {
      const manualId = Number(urlMap[comment.url]);
      let post = manualId ? posts.find(item => Number(item.id) === manualId) : null;
      const type = inferredType(comment.url);
      if (!post) {
        for (const candidate of pathCandidates(comment.url)) {
          post = byPath.get(`${type === null ? '*' : type}:${candidate}`) || byPath.get(`*:${candidate}`);
          if (post) break;
        }
      }
      if (!post && comment.title) post = byTitle.get(comment.title);
      return {...comment, post: post || null};
    });
  }

  async preview(comments, options = {}) {
    const resolved = this.resolve(comments, await this.posts(), options.urlMap || {});
    const matched = resolved.filter(item => item.post);
    const unmatched = resolved.filter(item => !item.post);
    const sourceUrls = new Set(comments.map(item => item.url));
    const matchedUrls = new Set(matched.map(item => item.url));
    return {
      total: comments.length,
      matched: matched.length,
      unmatched: unmatched.length,
      pages: sourceUrls.size,
      matchedPages: matchedUrls.size,
      statuses: matched.reduce((result, item) => ({...result, [item.status]: (result[item.status] || 0) + 1}), {}),
      unmatchedPages: [...new Set(unmatched.map(item => item.url))].slice(0, 100),
      resolved
    };
  }

  async run(comments, options = {}) {
    const preview = await this.preview(comments, options);
    const candidates = preview.resolved.filter(item => item.post);
    const byId = new Map(candidates.map(item => [item.sourceId, item]));
    candidates.sort((a, b) => depthOf(a, byId) - depthOf(b, byId));

    const commentModel = this.getModel('comment');
    const affected = new Set(candidates.map(item => Number(item.post.id)));
    const existing = affected.size ? await commentModel.where({post_id: ['IN', [...affected]]})
      .field('id,post_id,comment,mail,nick,pid,rid,inserted_at').select() : [];
    const known = new Map(existing.map(item => [
      fingerprint({...item, inserted_at: dateTime(item.inserted_at)}), item
    ]));
    const idMap = new Map();
    const rootMap = new Map();
    let imported = 0;
    let duplicates = 0;

    for (const item of candidates) {
      const parentId = idMap.get(item.parentId);
      const rootId = rootMap.get(item.parentId) || parentId;
      const created = dateTime(item.createdAt || this.now());
      const row = {
        comment: item.content,
        url: `/${Number(item.post.type) === 1 ? 'page' : 'post'}/${item.post.pathname}.html`,
        post_id: item.post.id,
        mail: item.email || null,
        nick: item.author || null,
        link: item.link || null,
        pid: parentId ? String(parentId) : null,
        rid: rootId ? String(rootId) : null,
        ua: item.ua || null,
        ip: item.ip || null,
        user_id: null,
        status: options.status === 'approved' ? 'approved' : item.status,
        sticky: item.sticky || 0,
        like: item.like || 0,
        inserted_at: created,
        created_at: created,
        updated_at: dateTime(item.updatedAt || item.createdAt || this.now())
      };
      const key = fingerprint(row);
      if (known.has(key)) {
        const duplicate = known.get(key);
        idMap.set(item.sourceId, duplicate.id);
        rootMap.set(item.sourceId, duplicate.rid || duplicate.id);
        duplicates++;
        continue;
      }
      const savedId = await commentModel.add(row);
      known.set(key, {...row, id: savedId});
      idMap.set(item.sourceId, savedId);
      rootMap.set(item.sourceId, rootId || savedId);
      imported++;
    }

    const postModel = this.getModel('post');
    for (const postId of affected) {
      const count = await commentModel.where({post_id: postId, status: ['NOT IN', ['waiting', 'spam']]}).count();
      await postModel.where({id: postId}).update({comment_num: Number(count)});
    }
    return {total: preview.total, matched: preview.matched, unmatched: preview.unmatched, imported, duplicates};
  }
}

module.exports = {CommentImporter, canonicalPath, dateTime, fingerprint, inferredType, pathCandidates};
