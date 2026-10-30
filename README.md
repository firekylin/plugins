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

- [`firekylin-plugin-embed`](packages/embed): automatically embed supported standalone media and code URLs.

## Publishing

Packages are published automatically through npm trusted publishing after their
version is changed on the `main` branch. Only direct workspace packages matching
`packages/*/package.json` are considered.

Publish each new package manually once with `npm publish --access public`. Then
configure its trusted publisher on npm with the GitHub organization
`firekylin`, repository `plugins`, and workflow filename `publish.yml`. No npm
access token is stored in GitHub.

## Marketplace registry

`registry.json` uses schema version 1 and is consumed by the plugin marketplace.
The **Sync published registry** workflow runs after **Publish packages** completes,
including partial failures, and can also be run manually on `main` to recover
from a delayed npm publication or a failed registry push. It does not republish
packages: successful matrix entries can be reconciled without retrying npm publish.

The dependency-free `.github/scripts/sync-registry.mjs` reconciles direct public
plugin packages against the public npm registry. It selects the highest published
stable version no newer than the package version on current `main`, never downgrades
an existing entry, and leaves unpublished packages alone. This also handles a newer
version bump arriving before the preceding release has been synchronized. Titles
and custom registry fields are preserved; version-dependent descriptions,
permissions, engines and plugin IDs come from the published manifest. Newly
published plugins are appended with their package name as the default title;
maintainers may customize that title in `registry.json`.

Synchronization writes only after all npm lookups succeed, retries transient
lookup failures, and makes no commit when nothing changed. Runs are serialized;
if `main` advances before push, the job fetches it and regenerates instead of
force-pushing. Only the sync job receives `contents: write`; it checks out trusted
`main` and consumes no artifacts or code from the triggering run. The repository
must allow `github-actions[bot]` to push registry updates to `main`; branch
protection failures are surfaced and can be recovered with a manual rerun.
Registry-only commits do not match the publish workflow's package paths, and the
workflow uses the default `GITHUB_TOKEN`, so synchronization cannot loop into
another publication. No additional token or npm credentials are required.

Run `node .github/scripts/sync-registry.mjs` to reconcile locally (requires network
access). `node --test test/sync-registry.test.js` tests publication gating,
partial failures, metadata preservation, ordering, idempotency and atomic writes.
The PR test workflow also runs the complete existing plugin test suite.

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
