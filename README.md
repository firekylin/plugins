# Firekylin Plugins

This repository is a pnpm monorepo for Firekylin plugins. Each plugin should
live in its own package under `packages/`, for example `packages/example-plugin`.

Create a `package.json` in each plugin directory and add that package's
dependencies, scripts, and Firekylin plugin entry point there. Install
dependencies from the repository root with `pnpm install`; pnpm discovers
packages through `pnpm-workspace.yaml`.

## Available plugins

- AI providers (install independently):
  [`Anthropic`](packages/ai-provider-anthropic),
  [`Google Gemini`](packages/ai-provider-google-gemini),
  [`Grok`](packages/ai-provider-grok),
  [`Vercel AI Gateway`](packages/ai-provider-vercel-ai-gateway),
  [`Ollama`](packages/ai-provider-ollama),
  [`QianWen`](packages/ai-provider-qianwen),
  [`Kimi`](packages/ai-provider-kimi),
  [`Cloudflare Workers AI`](packages/ai-provider-cloudflare),
  [`Xiaomi MiMo`](packages/ai-provider-xiaomi-mimo), and
  [`Doubao`](packages/ai-provider-doubao).
- [`firekylin-plugin-backup`](packages/backup): create manual or scheduled SQL backups and save them locally, send them by email, or both.
- [`firekylin-plugin-comment-import`](packages/comment-import): import comments from Waline, Valine,
  Artalk, Twikoo, Gitalk, Giscus, and Commento.
- [`firekylin-plugin-say`](packages/say): publish and manage lightweight microblog posts with tags,
  media links, a public page, theme integrations, and an API-key-protected publishing endpoint.
- [`firekylin-plugin-friend-links`](packages/friend-links): manage categorized friend links and expose
  them through a standalone page, JSON API, template function, and theme widget.
- [`firekylin-plugin-markdown-route`](packages/markdown-route): expose public, published articles as raw Markdown at `/<slug>.md`.
- [`firekylin-plugin-relate-post`](packages/relate-post): recommend related public posts using shared tags and categories.

## Publishing

Packages are published automatically through npm trusted publishing after their
version is changed on the `main` branch. Only direct workspace packages matching
`packages/*/package.json` are considered.

Publish each new package manually once with `npm publish --access public`. Then
configure its trusted publisher on npm with the GitHub organization
`firekylin`, repository `plugins`, and workflow filename `publish.yml`. No npm
access token is stored in GitHub.

## AI usage metadata

Provider results preserve their native `usage` property and additionally return `usageDetails` with
input/output/total tokens plus available cache-read, cache-write and reasoning counts. Missing values
are `null`; a reported zero stays zero. Totals are derived only when both input and output are known.
Cache and reasoning detail fields are not added twice. Anthropic input includes its separate cache
counts; Gemini output includes candidates and reported thought tokens. Gemini and Ollama no longer
fill missing usage with zero.

When upstream request-ID headers are available, `providerRequestId` is included in results or errors.
No full HTTP responses or headers are attached for auditing. Core owns audit storage and authenticated
caller attribution; these plugins only map provider-specific metadata. Helpers ship in each package's
`lib` directory so providers remain independently installable. No pricing or fee estimation is added.
