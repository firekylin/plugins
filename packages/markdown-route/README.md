# Firekylin Markdown Route Plugin

Expose the original Markdown source of each published Firekylin article at `/<slug>.md`.

For an article whose slug is `hello-world`:

```text
GET /hello-world.md
Content-Type: text/markdown; charset=utf-8
```

The response body is the article's stored `markdown_content` without an added title or front matter. `HEAD` requests
return the same headers with an empty body.

## Installation

Copy this package to Firekylin's plugin directory, or add `@firekylin/plugin-markdown-route` to the application's
dependencies, then restart Firekylin.

## Visibility rules

The route only exposes articles that are published, public, and whose publication time has arrived. Drafts, private
articles, scheduled articles, pages, and password-protected articles return `404` so the route cannot bypass normal
content protection.
