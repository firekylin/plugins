'use strict';

const TurndownService = require('turndown');

const turndown = new TurndownService({codeBlockStyle: 'fenced'});
const SUPPORTED_SOURCES = new Set([
  'waline', 'valine', 'artalk', 'twikoo', 'gitalk', 'giscus', 'commento'
]);

function value(...items) {
  return items.find(item => item !== undefined && item !== null && item !== '');
}

function identifier(item) {
  const id = value(item.objectId, item._id, item.id, item.commentHex, item.comment_id, item.commentId);
  if (id && typeof id === 'object') return value(id.$oid, id.oid, JSON.stringify(id));
  return id === undefined ? '' : String(id);
}

function date(value) {
  if (value && typeof value === 'object') value = value.iso || value.$date || value.value;
  if (typeof value === 'number' && value < 100000000000) value *= 1000;
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function truthy(value) {
  return value === true || value === 1 || ['true', '1'].includes(String(value).toLowerCase());
}

function likes(value) {
  if (Array.isArray(value)) return value.length;
  return Number(value) || 0;
}

function reference(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value);
  return ['0', 'root', 'null', 'undefined'].includes(normalized.toLowerCase()) ? '' : normalized;
}

function author(item) {
  const user = item.author || item.user || item.owner || {};
  return {
    nick: String(value(item.nick, item.name, item.author_name, user.name, user.login, user.username) || 'Anonymous'),
    mail: String(value(item.mail, item.email, item.author_email, user.email) || ''),
    link: String(value(item.link, item.website, item.author_url, user.website, user.url, user.html_url) || '')
  };
}

function common(item, overrides = {}) {
  return {
    sourceId: identifier(item),
    sourceUserId: String(value(item.user_id, item.userId) || ''),
    parentId: reference(value(item.pid, item.parentId, item.parent_id, item.parentHex, item.reply_to, item.rid)),
    rootId: reference(value(item.rootId, item.root_id)),
    url: String(value(item.url, item.path, item.page_key, item.pageKey, item.relative_url, item.pathname) || ''),
    content: String(value(item.comment, item.content, item.markdown, item.body, item.bodyText, item.text) || ''),
    ...author(item),
    ua: String(value(item.ua, item.user_agent, item.userAgent) || ''),
    ip: String(value(item.ip, item.ip_address, item.ipAddress) || ''),
    status: value(item.status, item.state, truthy(item.isSpam) ? 'spam' : undefined,
      truthy(item.is_pending) ? 'waiting' : undefined, item.deleted === true ? 'deleted' : undefined),
    like: likes(value(item.like, item.likes, item.vote_up, item.score)),
    insertedAt: date(value(item.insertedAt, item.inserted_at, item.createdAt, item.created_at,
      item.creationDate, item.created)),
    createdAt: date(value(item.createdAt, item.created_at, item.creationDate, item.created)),
    updatedAt: date(value(item.updatedAt, item.updated_at, item.updated)),
    ...overrides
  };
}

function arrayAt(input, names) {
  if (Array.isArray(input)) return input;
  for (const name of names) if (Array.isArray(input && input[name])) return input[name];
  if (input && input.data && typeof input.data === 'object' && input.data !== input) {
    return arrayAt(input.data, names);
  }
  return [];
}

function walineLike(input) {
  const official = input && input.data && input.data.Comment;
  return arrayAt(official || input, ['Comment', 'comments', 'results', 'data', 'objects'])
    .map(item => common(item));
}

const WALINE_USER_FIELDS = new Set([
  'objectId', '_id', 'id', 'email', 'mail', 'display_name', 'displayName', 'name', 'nick', 'url', 'link',
  'avatar', 'password', 'type', 'status', 'label', '2fa', 'createdAt', 'created_at', 'updatedAt',
  'updated_at', 'insertedAt', 'ACL', 'sessionToken', 'authData'
]);

function walineUsers(input) {
  const official = input && input.data && input.data.Users;
  return arrayAt(official || (input && input.Users), ['Users', 'users', 'results', 'data', 'objects'])
    .map(item => ({
      sourceId: identifier(item),
      email: String(value(item.email, item.mail) || '').trim().toLowerCase(),
      displayName: String(value(item.display_name, item.displayName, item.name, item.nick) || 'Commenter'),
      url: String(value(item.url, item.link) || ''),
      avatar: String(value(item.avatar) || ''),
      label: String(value(item.label) || ''),
      createdAt: date(value(item.createdAt, item.created_at)),
      socials: Object.entries(item).filter(([provider, accountId]) =>
        !WALINE_USER_FIELDS.has(provider) && /^[a-z][a-z0-9_-]{0,31}$/i.test(provider) &&
        ['string', 'number'].includes(typeof accountId) && String(accountId).trim()
      ).map(([provider, accountId]) => ({provider, accountId: String(accountId).trim()}))
    }));
}

function artalk(input) {
  return arrayAt(input, ['comments', 'data']).map(item => common(item, {
    parentId: reference(value(item.rid, item.reply_to, item.parent_id)),
    rootId: '',
    status: truthy(item.is_pending) ? 'waiting' : truthy(item.is_collapsed) ? 'spam' : value(item.status, 'approved')
  }));
}

function twikoo(input) {
  return walineLike(input).map(item => ({...item, content: turndown.turndown(item.content)}));
}

function githubComments(thread, comments, nested = false) {
  const threadKeys = [thread.id, thread.number, thread.url, thread.html_url, thread.title]
    .filter(item => item !== undefined && item !== null).map(String);
  const result = [];
  const visit = (item, parentId = '') => {
    const normalized = common(item, {
      parentId,
      url: '',
      threadKeys,
      nick: author(item).nick,
      link: author(item).link
    });
    result.push(normalized);
    if (nested) {
      const replies = arrayAt(item.replies, ['nodes', 'data', 'comments']);
      replies.forEach(reply => visit(reply, normalized.sourceId));
    }
  };
  comments.forEach(item => visit(item));
  return result;
}

function gitalk(input) {
  const issues = arrayAt(input, ['issues', 'items', 'data']);
  const flatComments = Array.isArray(input && input.comments) ? input.comments : [];
  return issues.flatMap(issue => {
    const comments = arrayAt(issue.comments, ['nodes', 'items', 'data']);
    const issueComments = comments.length ? comments : flatComments.filter(comment =>
      String(value(comment.issue_url, comment.issueUrl, comment.issue_number, comment.issueNumber) || '') ===
      String(value(issue.url, issue.number) || '')
    );
    return githubComments(issue, issueComments);
  });
}

function discussionNodes(input) {
  if (Array.isArray(input)) return input;
  return arrayAt(input, ['discussions', 'nodes', 'items', 'data']).length
    ? arrayAt(input, ['discussions', 'nodes', 'items', 'data'])
    : arrayAt(input && input.data && input.data.repository && input.data.repository.discussions, ['nodes']);
}

function giscus(input) {
  return discussionNodes(input).flatMap(discussion => {
    const comments = arrayAt(discussion.comments, ['nodes', 'items', 'data']);
    return githubComments(discussion, comments, true);
  });
}

function commento(input) {
  const commenters = new Map(arrayAt(input && input.commenters, ['data']).map(item => [String(item.commenterHex), item]));
  return arrayAt(input, ['comments', 'data']).map(item => {
    const identity = commenters.get(String(item.commenterHex)) || {};
    const parent = reference(value(item.parentHex, item.parent_id, item.parentId));
    return common({...identity, ...item}, {
      parentId: parent,
      rootId: '',
      url: String(value(item.path, item.url) || ''),
      content: String(value(item.markdown, item.comment, item.content) || '')
    });
  });
}

function parse(source, input) {
  if (!SUPPORTED_SOURCES.has(source)) throw new Error(`Unsupported comment source: ${source}`);
  if (['waline', 'valine'].includes(source)) return walineLike(input);
  if (source === 'twikoo') return twikoo(input);
  if (source === 'artalk') return artalk(input);
  if (source === 'gitalk') return gitalk(input);
  if (source === 'giscus') return giscus(input);
  return commento(input);
}

function parseUsers(source, input) {
  return source === 'waline' ? walineUsers(input) : [];
}

module.exports = {SUPPORTED_SOURCES, parse, parseUsers};
