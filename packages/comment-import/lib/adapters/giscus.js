'use strict';

const {asArray, connectionNodes, first, githubAuthor, normalize} = require('./helpers');

function walkComments(value, discussion, parentId, rootId, output) {
  for (const comment of connectionNodes(value)) {
    const id = String(first(comment.id, comment.databaseId, comment.node_id, ''));
    const normalized = normalize({
      ...comment,
      ...githubAuthor(comment),
      sourceId: id,
      parentId,
      rootId,
      content: first(comment.body, comment.bodyText),
      url: first(discussion.urlPath, discussion.pathname, discussion.pageUrl, discussion.page_url, discussion.title),
      title: discussion.title,
      createdAt: first(comment.createdAt, comment.created_at),
      updatedAt: first(comment.updatedAt, comment.updated_at),
      like: first(comment.reactions && comment.reactions.totalCount, 0)
    });
    output.push(normalized);
    walkComments(comment.replies, discussion, id, rootId || id, output);
  }
}

module.exports = input => {
  const repository = first(input.data && input.data.repository, input.repository, input.data, input) || {};
  const discussions = asArray(first(repository.discussions && repository.discussions.nodes,
    repository.discussions, input.discussions && input.discussions.nodes, input.discussions, input));
  const output = [];
  for (const discussion of discussions) walkComments(discussion.comments, discussion, '', '', output);
  return output;
};
