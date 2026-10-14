'use strict';

function first(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function isoDate(value) {
  if (!value) return null;
  if (value && typeof value === 'object' && value.iso) value = value.iso;
  if (typeof value === 'number' && value < 1e12) value *= 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function flag(value) {
  return value === true || value === 1 || ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

function status(value, {pending = false, spam = false} = {}) {
  if (flag(spam) || ['spam', 'trash', 'deleted'].includes(String(value).toLowerCase())) return 'spam';
  if (flag(pending) || ['pending', 'waiting', 'hold', 'unapproved'].includes(String(value).toLowerCase())) return 'waiting';
  return 'approved';
}

function normalize(record) {
  return {
    sourceId: String(first(record.sourceId, record.id, record._id, record.objectId, '')),
    parentId: String(first(record.parentId, record.pid, '')),
    rootId: String(first(record.rootId, record.rid, '')),
    content: String(first(record.content, record.comment, record.body, record.text, record.markdown, '')),
    url: String(first(record.url, record.path, record.pageKey, record.page_key, record.pageId, '')),
    title: String(first(record.title, record.pageTitle, record.page_title, '')),
    author: String(first(record.author, record.nick, record.name, record.user && record.user.login, '')),
    email: String(first(record.email, record.mail, '')),
    link: String(first(record.link, record.website, record.authorUrl, record.author_url, '')),
    ip: String(first(record.ip, '')),
    ua: String(first(record.ua, record.userAgent, record.user_agent, '')),
    status: record.status || 'approved',
    like: Number(first(record.like, record.likes, record.score, 0)) || 0,
    sticky: Number(Boolean(first(record.sticky, record.pinned, false))),
    createdAt: isoDate(first(record.createdAt, record.created_at, record.insertedAt, record.inserted_at, record.time, record.created, record.date)) || new Date().toISOString(),
    updatedAt: isoDate(first(record.updatedAt, record.updated_at, record.modifiedAt, record.modified_at, record.updated)) || null
  };
}

function githubAuthor(node) {
  const author = node.author || node.user || {};
  return {
    author: first(author.login, author.name, node.author_association === 'OWNER' ? 'Owner' : ''),
    link: first(author.url, author.html_url, author.websiteUrl, ''),
    email: first(node.email, '')
  };
}

function connectionNodes(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.nodes)) return value.nodes;
  if (value && Array.isArray(value.edges)) return value.edges.map(edge => edge.node).filter(Boolean);
  return [];
}

module.exports = {asArray, connectionNodes, first, flag, githubAuthor, isoDate, normalize, status};
