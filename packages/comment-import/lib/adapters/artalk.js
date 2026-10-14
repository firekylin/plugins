'use strict';

const {asArray, first, normalize, status} = require('./helpers');

module.exports = input => asArray(first(input.comments, input.data && input.data.comments, input.data, input)).map(item => normalize({
  ...item,
  sourceId: first(item.id, item.uuid),
  parentId: first(item.rid, item.parent_id, item.parentId),
  rootId: first(item.root_id, item.rootId),
  content: first(item.content, item.content_marked),
  url: first(item.page_key, item.pageKey, item.url),
  title: first(item.page_title, item.pageTitle),
  author: first(item.nick, item.name),
  email: first(item.email, item.mail),
  status: status(item.status, {spam: item.is_spam || item.is_collapsed, pending: item.is_pending}),
  like: first(item.vote_up, item.like, item.likes),
  createdAt: first(item.created_at, item.createdAt),
  updatedAt: first(item.updated_at, item.updatedAt)
}));
