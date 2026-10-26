'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const MarkdownIt = require('markdown-it');
const plugin = require('../plugin');
const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const render = text => new MarkdownIt({linkify: true}).use(plugin.embedPlugin).render(text);

test('registers the Markdown filter and returns the parser', () => {
  let callback;
  plugin.register({events: {on(name, fn) { assert.equal(name, 'markdown.configure'); callback = fn; }}});
  const md = new MarkdownIt();
  assert.equal(callback(md), md);
  assert.match(md.render(url), /<iframe/);
});
test('embeds standalone paragraphs and retains a fallback link', () => {
  const html = render(`Before\n\n${url}\n\n${url}\n\nAfter`);
  assert.equal((html.match(/<iframe/g) || []).length, 2);
  assert.match(html, /youtube-nocookie.com/);
  assert.match(html, /<a href=/);
  assert.match(html, /<p>After<\/p>/);
});
test('preserves inline links, explicit links, code, lists and unknown URLs', () => {
  for (const input of [`See ${url}`, `text\n${url}`, `[video](${url})`, `<${url}>`, `\`${url}\``, '```\n' + url + '\n```', `- ${url}`, 'https://example.com/video']) {
    assert.doesNotMatch(render(input), /<iframe/);
  }
});
test('supports provider URLs and rejects unsafe or malformed input', () => {
  for (const input of ['https://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/123456', 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2', 'https://gist.github.com/user/abc123', 'https://jsfiddle.net/user/abc123/2/']) assert.ok(plugin.resolveEmbed(input), input);
  for (const input of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:444/watch?v=dQw4w9WgXcQ', 'https://youtu.be/bad', 'https://gist.github.com/user/abc/evil']) assert.equal(plugin.resolveEmbed(input), null, input);
});
test('provider allowlist and attribute escaping', () => {
  const md = new MarkdownIt().use(plugin.embedPlugin, {providers: []});
  assert.doesNotMatch(md.render(url), /<iframe/);
  assert.match(render(url + '&x="evil"'), /&quot;evil&quot;/);
});
