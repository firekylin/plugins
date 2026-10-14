# Firekylin Comment Import

Imports third-party comments into Firekylin from:

- Waline and Valine JSON/LeanCloud exports
- Artalk JSON exports
- Twikoo JSON/MongoDB exports
- Gitalk GitHub Issues with embedded or separately exported issue comments
- Giscus GitHub Discussions GraphQL JSON with comments and replies
- Commento JSON exports

The plugin requires Firekylin 2.10.0 or newer because it uses the declarative admin UI API.

## Install

Add this package as a direct dependency of a Firekylin site project, then restart Firekylin:

```sh
pnpm add @firekylin/plugin-comment-import
```

Open **评论导入 → 第三方评论导入** in the admin sidebar. Select the source, paste the exported JSON, leave **仅预演** enabled, and process the preview. Back up the database before the real import.

Regular JSON and LeanCloud JSON Lines exports are accepted. Twikoo HTML comments are converted to Markdown. Decompress Commento's `.json.gz` export before pasting its JSON content.

The importer preserves comment text, author metadata, timestamps, moderation state, likes, and reply relationships where the source export provides them. It recalculates `comment_num` for affected posts and skips existing comments using a content fingerprint, so the same export can be retried safely.

## Page matching

Waline, Valine, Artalk, Twikoo, and Commento normally contain a page path. A path already shaped like `/post/slug.html` or `/page/slug.html` is matched automatically. Full URLs with one of those paths are also accepted.

Use the optional page map when the old site used different URLs or when importing Gitalk/Giscus. Keys can be a source path, thread/comment ID, GitHub Issue/Discussion ID, number, API URL, browser URL, or title. Values can be a Firekylin route or numeric post ID:

```json
{
  "/articles/old-node-post": "/post/node-post.html",
  "123": "/post/gitalk-thread.html",
  "Welcome to the discussion": 42
}
```

Unmatched comments are reported and left unchanged. The importer never guesses a destination post.

## Expected GitHub exports

Gitalk input accepts either Issues containing a `comments` array or this envelope:

```json
{
  "issues": [{"id": 1, "number": 10, "title": "Thread", "url": "https://api.github.com/.../issues/10"}],
  "comments": [{"id": 2, "issue_url": "https://api.github.com/.../issues/10", "body": "Hello", "user": {"login": "octocat"}}]
}
```

Giscus accepts GitHub GraphQL output shaped as `data.repository.discussions.nodes`, including each discussion's `comments.nodes` and every comment's `replies.nodes`. Fetch all pagination pages before importing; counts without comment nodes contain no data to import.

## Operational notes

- One submission is limited to 8 MiB and 50,000 parsed comments.
- Deleted source comments are skipped. Unknown states use the selected default state.
- Source account IDs are not copied into Firekylin `user_id`; third-party identities are retained as comment author metadata.
- Cyclic or missing reply references are imported as top-level comments and reported.
- The operation can partially complete if the database becomes unavailable. Retry the same export after recovery; fingerprint checks skip rows already written.
- Exported comments contain personal data. Store, transport, and delete export files according to the site's privacy obligations.
