'use strict';

const {asArray, first, normalize, status} = require('./helpers');

module.exports = input => asArray(first(input.comments, input.data, input.result, input)).map(item => normalize({
  ...item,
  sourceId: first(item.id, item._id, item.uid),
  parentId: first(item.pid, item.parentId),
  rootId: first(item.rid, item.rootId),
  status: status(item.status, {spam: item.isSpam || item.is_spam}),
  createdAt: first(item.created, item.createdAt, item.created_at),
  updatedAt: first(item.updated, item.updatedAt, item.updated_at)
}));
