'use strict';

const {asArray, first, githubAuthor, normalize} = require('./helpers');

function issueUrl(issue) {
  const labels = asArray(issue.labels).map(label => typeof label === 'string' ? label : label.name);
  const pathLabel = labels.find(label => /^https?:\/\/|^\//.test(String(label || '')));
  const bodyUrl = String(issue.body || '').match(/https?:\/\/[^\s\])]+/);
  return first(issue.urlPath, issue.pathname, issue.pageUrl, issue.page_url, pathLabel,
    bodyUrl && bodyUrl[0], issue.title);
}

module.exports = input => {
  const issues = asArray(first(input.issues, input.data && input.data.issues, input));
  const result = [];
  for (const issue of issues) {
    const url = issueUrl(issue);
    const comments = asArray(first(issue.comments, issue.nodes, []));
    for (const comment of comments) {
      result.push(normalize({
        ...comment,
        ...githubAuthor(comment),
        sourceId: first(comment.id, comment.node_id, comment.databaseId),
        content: first(comment.body, comment.bodyText),
        url,
        title: issue.title,
        createdAt: first(comment.created_at, comment.createdAt),
        updatedAt: first(comment.updated_at, comment.updatedAt),
        like: first(comment.reactions && comment.reactions.totalCount, comment.reactions && comment.reactions['+1'], 0)
      }));
    }
  }
  return result;
};
