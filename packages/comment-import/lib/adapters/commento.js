'use strict';

const {asArray, first, normalize, status} = require('./helpers');

module.exports = input => {
  const commenters = new Map(asArray(first(input.commenters, input.users, [])).map(user => [
    String(first(user.commenterHex, user.commenter_hex, user.id, '')),
    user
  ]));
  return asArray(first(input.comments, input.data, input)).map(item => {
    const user = commenters.get(String(first(item.commenterHex, item.commenter_hex, item.userId, ''))) || {};
    return normalize({
      ...item,
      sourceId: first(item.commentHex, item.comment_hex, item.id),
      parentId: first(item.parentHex, item.parent_hex, item.parentId),
      content: first(item.markdown, item.html, item.content),
      url: first(item.pageId, item.page_id, item.url),
      author: first(user.name, item.name, item.author),
      email: first(user.email, item.email),
      link: first(user.website, item.website),
      status: status(item.state, {spam: item.deleted === true}),
      createdAt: first(item.creationDate, item.creation_date, item.createdAt),
      updatedAt: first(item.modifiedDate, item.modified_date, item.updatedAt)
    });
  });
};
