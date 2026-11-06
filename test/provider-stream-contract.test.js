'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ids = ['openai', 'deepseek', 'anthropic', 'cloudflare', 'doubao', 'google-gemini', 'grok', 'kimi', 'ollama', 'qianwen', 'vercel-ai-gateway', 'xiaomi-mimo'];
for (const id of ids) {
  test(`${id}: returns the unread upstream stream to core`, async t => {
    let provider;
    await require(`../packages/ai-provider-${id}/plugin`).register({
      ai: {credentials: {get: async name => ({apiKey: 'test', accountId: 'a'.repeat(32), modelId: 'test'})[name]},
        registerProvider: value => {provider = value}}, admin: {registerForm() {}, registerAction() {}}
    });
    const response = {ok: true, headers: new Headers({'content-type': 'text/event-stream'}),
      body: {async *[Symbol.asyncIterator]() {throw new Error('provider must not read the stream')}},
      json() {throw new Error('provider must not parse the stream')}};
    const previous = global.fetch;
    t.after(() => {global.fetch = previous});
    global.fetch = async() => response;
    const result = await provider.generate({model: 'test', messages: [{role: 'user', content: 'hi'}]}, {
      onText() {throw new Error('core owns callbacks')}, streamResponse: Object.assign((stream, protocol) => ({stream, protocol}), {supportsCustomParser: true})
    });
    assert.equal(result.stream, response);
    if (['anthropic', 'google-gemini'].includes(id)) {
      assert.equal(result.protocol.format, 'sse');
      assert.equal(typeof result.protocol.parse, 'function');
      await assert.rejects(provider.generate({model: 'test', messages: []}, {onText() {}, streamResponse() {}}), /updated Firekylin core/);
    } else assert.equal(result.protocol, {openai: 'responses', ollama: 'ollama'}[id] || 'chat-completions');
    assert.equal(result.provider, id);
    await assert.rejects(provider.generate({model: 'test', messages: []}, {onText() {}}), /updated Firekylin core/);
  });
}
