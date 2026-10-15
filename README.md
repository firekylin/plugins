# Firekylin Plugins

This repository is a pnpm monorepo for Firekylin plugins. Each plugin should
live in its own package under `packages/`, for example `packages/example-plugin`.

Create a `package.json` in each plugin directory and add that package's
dependencies, scripts, and Firekylin plugin entry point there. Install
dependencies from the repository root with `pnpm install`; pnpm discovers
packages through `pnpm-workspace.yaml`.

## Available plugins

- [`firekylin-plugin-backup`](packages/backup): create manual or scheduled SQL backups and save them locally, send them by email, or both.
- [`firekylin-plugin-comment-import`](packages/comment-import): import comments from Waline, Valine,
  Artalk, Twikoo, Gitalk, Giscus, and Commento.
- [`firekylin-plugin-friend-links`](packages/friend-links): manage categorized friend links and expose
  them through a standalone page, JSON API, template function, and theme widget.
- [`@firekylin/plugin-markdown-route`](packages/markdown-route): expose public, published articles as raw Markdown at `/<slug>.md`.
- [`@firekylin/plugin-relate-post`](packages/relate-post): recommend related public posts using shared tags and categories.

## Publishing

Packages are published automatically through npm trusted publishing after their
version is changed on the `main` branch. Only direct workspace packages matching
`packages/*/package.json` are considered.

Publish each new package manually once with `npm publish --access public`. Then
configure its trusted publisher on npm with the GitHub organization
`firekylin`, repository `plugins`, and workflow filename `publish.yml`. No npm
access token is stored in GitHub.
