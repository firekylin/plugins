'use strict';

const {asArray, first, normalize, status} = require('./helpers');

module.exports = input => asArray(first(input.comments, input.data, input)).map(item => normalize({
  ...item,
  sourceId: first(item.objectId, item.id, item._id),
  parentId: first(item.pid, item.parent_id),
  rootId: first(item.rid, item.root_id),
  status: status(item.status, {spam: item.isSpam || item.is_spam}),
  createdAt: first(item.insertedAt, item.createdAt, item.created_at),
  updatedAt: first(item.updatedAt, item.updated_at)
}));
