# Firekylin Related Posts Plugin

Recommend related public posts using shared tags and categories. Results are ranked by configurable weights and then by publication time. Drafts, private posts, future posts, the current post, and password-protected posts are never shown.

## Installation

Copy this package to Firekylin's plugin directory, or add `@firekylin/plugin-relate-post` to the application's dependencies. Restart Firekylin, then configure the plugin from **Related Posts → Related Post Settings** in the admin panel.

## Theme integration

The plugin automatically inserts its HTML on post pages for themes that do not expose a plugin slot. Themes can choose the exact location by rendering the standard slot:

```eta
<%~ await slots.render('post.after') %>
```

When the slot output is present, automatic insertion detects it and does not add a duplicate.

A theme can also iterate the registered Widget:

```eta
<%
const related = await firekylin.widget('Widget_Plugin_Relate_Posts', {
  postId: post.id
});
%>
<% while (related.next()) { %>
  <a href="<%= related.url %>"><%= related.title %></a>
<% } %>
```

For custom layouts, `plugin['relate-post'].list({post, limit: 6})` returns an array of post records. Escape values before rendering them into HTML.

## Ranking

Each shared tag adds the configured tag weight and each shared category adds the category weight. Higher scores appear first; equal scores use the newest publication time. When no taxonomy matches exist, the plugin can optionally show recent posts.
