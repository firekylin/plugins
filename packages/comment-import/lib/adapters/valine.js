'use strict';

const {asArray, first, normalize, status} = require('./helpers');

module.exports = input => {
  const records = asArray(first(input.Comment, input.comments, input.results, input));
  return records.map(item => normalize({
    ...item,
    sourceId: first(item.objectId, item.id, item._id),
    parentId: first(item.pid, item.parentId, item.parent_id),
    rootId: first(item.rid, item.rootId, item.root_id),
    content: first(item.comment, item.content),
    url: first(item.url, item.pathname),
    author: first(item.nick, item.name, item.username),
    email: first(item.mail, item.email),
    link: first(item.link, item.website),
    status: status(item.status, {spam: item.isSpam || item.is_spam, pending: item.isPending}),
    createdAt: first(item.createdAt, item.created_at),
    updatedAt: first(item.updatedAt, item.updated_at)
  }));
};
