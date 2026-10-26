# firekylin-plugin-embed

WordPress-style automatic embeds for Firekylin: paste a supported HTTP(S) URL
as the only content in a paragraph (separate it from surrounding text with blank lines).
No custom template syntax is needed. Markdown source remains unchanged.

```markdown
A video:

https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Install in your site project with `npm install firekylin-plugin-embed`, then restart
Firekylin. Requires a core providing the `markdown.configure` plugin filter
(declared compatibility: Firekylin >=2.10.6).

Supported URLs: YouTube watch/shorts/embed and youtu.be links, public numeric
Vimeo links, Bilibili BV/av video links (including `p`), GitHub Gist owner/id
links, and JSFiddle fiddle links with optional owner and revision.
Gist uses its `.pibb` iframe representation; third-party availability and framing
policies may affect embeds. Recognized URLs render only the embed, without an
additional original-link label. Unsupported URLs remain ordinary links.

Inline URLs, explicit Markdown links/autolinks, code, tight list items, unsupported
URLs and malformed URLs stay unchanged. Blockquotes and loose-list paragraphs
follow the same standalone-paragraph rule. To retain a supported URL as a link,
write `[watch video](URL)` or `<URL>`.

Frames use HTTPS, lazy loading, a sandbox, and responsive sizing. No remote
metadata requests or arbitrary third-party scripts run on the Firekylin server.
This uses fixed provider adapters rather than oEmbed discovery. Players may
contact their providers when loaded; browser privacy/CSP settings can block them.
Video start-time options are not currently forwarded; Bilibili does not autoplay.

Optionally restrict providers in `pluginConfig.embed.providers` to a list of
embed hostnames: `www.youtube-nocookie.com`, `player.vimeo.com`,
`player.bilibili.com`, `gist.github.com`, `jsfiddle.net`. An empty list disables
all embeds. Omitting the setting enables all supported providers.

Run `pnpm --filter firekylin-plugin-embed test` to test.
