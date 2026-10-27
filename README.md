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
- [`@firekylin/plugin-marketplace`](packages/marketplace): browse and manage trusted Firekylin plugins and themes.
- [`firekylin-plugin-markdown-route`](packages/markdown-route): expose public, published articles as raw Markdown at `/<slug>.md`.
- [`firekylin-plugin-relate-post`](packages/relate-post): recommend related public posts using shared tags and categories.
- [`firekylin-plugin-embed`](packages/embed): automatically embed supported standalone media and code URLs.

## Publishing

Packages are published automatically through npm trusted publishing after their
version is changed on the `main` branch. Only direct workspace packages matching
`packages/*/package.json` are considered.

Publish each new package manually once with `npm publish --access public`. Then
configure its trusted publisher on npm with the GitHub organization
`firekylin`, repository `plugins`, and workflow filename `publish.yml`. No npm
access token is stored in GitHub.

## AI usage metadata

Providers declare `usageAdapter` when registering: a standard protocol (`chat-completions` or
`responses`) plus optional native field overrides. Selectors support dotted paths, ordered fallback
paths, and sums with explicit defaults for optional native counters. Only Anthropic, Gemini, Ollama
and DeepSeek need custom mappings.

The core supplies `reportUsage(rawUsage, response)` in the generation context. Clients report headers
once available, then native usage after parsing the response, before checking for empty output.
Core immediately extracts declared counters and the request ID; it never retains the full response.
Core owns normalization, missing/zero handling, safe total derivation, and audit persistence. Provider
results keep their original `usage` shape; the core adds normalized `usageDetails` to successful results.
Failures keep their original errors while already reported usage remains available to the audit log.

There is no shared utility npm package or additional publishing dependency. Older cores may omit the
reporting callback; clients still generate normally, but normalized audit metadata requires the updated core.
Provider contracts are covered by `test/ai-provider-usage.test.js`; normalization is tested in core.
Set `FIREKYLIN_CORE_PATH` to a local core checkout when running that contract suite to additionally
verify all provider declarations against the actual core normalizer.
