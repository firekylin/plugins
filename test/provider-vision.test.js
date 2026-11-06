'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const corePath = process.env.FIREKYLIN_CORE_PATH;
const chatIds = ['kimi', 'doubao', 'grok', 'xiaomi-mimo', 'vercel-ai-gateway', 'deepseek', 'qianwen', 'cloudflare'];
const ids = ['openai', 'anthropic', 'google-gemini', ...chatIds, 'ollama'];
for (const id of ids) {
  test(`${id}: rejects image messages on old core rather than silently dropping them`, async() => {
    const generate = require(`../packages/ai-provider-${id}/lib/client`).generate;
    let called = false;
    await assert.rejects(generate({apiKey: 'test', accountId: 'a'.repeat(32), request: {model: 'test', messages: [
      {role: 'user', content: '', images: [{mimeType: 'image/png', data: 'YWJj'}]}]},
    fetchImpl: async() => {called = true}}), /vision API/);
    assert.equal(called, false);
  });
  for (const streaming of [false, true]) test(`${id}: registered provider sends image-only and historical images through real core (${streaming ? 'stream' : 'JSON'})`,
    {skip: !corePath}, async t => {
      const AIClient = require(path.join(corePath, 'src/ai/client'));
      const Registry = require(path.join(corePath, 'src/ai/registry'));
      const sharp = require(path.join(corePath, 'node_modules/sharp'));
      const bytes = await sharp({create: {width: 32, height: 32, channels: 3, background: '#ff0000'}}).png().toBuffer();
      const image = {mimeType: 'image/png', data: bytes.toString('base64')};
      const providers = new Registry();
      await require(`../packages/ai-provider-${id}/plugin`).register({
        ai: {credentials: {get: async name => name === 'apiKey' ? 'test' : name === 'modelId' ? 'local-test' : name === 'accountId' ? 'a'.repeat(32) : undefined, has: async() => true},
          registerProvider: value => providers.register(value)}, admin: {registerForm() {}, registerAction() {}}
      });
      const model = providers.get(id).models.find(model => model.capabilities.includes('vision'));
      assert.ok(model);
      assert.ok(providers.get(id).models.filter(model => model.id === 'custom' || model.capabilities.includes('image'))
        .every(model => !model.capabilities.includes('vision')));
      const client = new AIClient({providers, preferences: {get: async() => ({provider: id, model: model.id})},
        audit: {resolve: async() => {}, finish: async() => {}, start: async(_, context) => {assert.equal(context.recordContent, false)}}});
      const previousFetch = global.fetch;
      t.after(() => {global.fetch = previousFetch});
      let calls = 0;
      global.fetch = async(url, init) => {
        if (id === 'ollama' && url.endsWith('/api/show')) {
          assert.deepEqual(JSON.parse(init.body), {model: 'local-test'});
          return {ok: true, json: async() => ({capabilities: ['vision']})};
        }
        calls++;
        const body = JSON.parse(init.body);
        const user = (body.input || body.messages || body.contents).filter(item => item.role === 'user');
        assert.equal(user.length, 2);
        for (const item of user) {
          const parts = item.content || item.parts;
          if (id === 'ollama') {
            assert.deepEqual(item.images, [image.data]);
            continue;
          }
          assert.ok(Array.isArray(parts));
          if (chatIds.includes(id)) assert.deepEqual(parts.find(part => part.type === 'image_url'),
            {type: 'image_url', image_url: {url: `data:image/png;base64,${image.data}`}});
          if (id === 'openai') assert.deepEqual(parts.find(part => part.type === 'input_image'),
            {type: 'input_image', image_url: `data:image/png;base64,${image.data}`});
          if (id === 'anthropic') assert.deepEqual(parts.find(part => part.type === 'image'),
            {type: 'image', source: {type: 'base64', media_type: 'image/png', data: image.data}});
          if (id === 'google-gemini') assert.deepEqual(parts.find(part => part.inlineData), {inlineData: image});
        }
        if (!streaming) return {ok: true, json: async() => ({choices: [{message: {content: 'red'}}], message: {content: 'red'}, output_text: 'red', content: [{type: 'text', text: 'red'}],
          candidates: [{content: {parts: [{text: 'red'}]}}]})};
        if (id === 'ollama') return {ok: true, headers: new Headers({'content-type': 'application/x-ndjson'}),
          body: (async function*() {yield Buffer.from(JSON.stringify({message: {content: 'red'}, done: true}) + '\n')})()};
        const events = chatIds.includes(id) ? [
          {choices: [{index: 0, delta: {content: 'red'}, finish_reason: 'stop'}]}
        ] : id === 'openai' ? [
          {type: 'response.output_text.delta', delta: 'red'}, {type: 'response.completed', response: {status: 'completed', output: [{content: [{type: 'output_text', text: 'red'}]}]}}
        ] : id === 'anthropic' ? [
          {type: 'message_start', message: {usage: {input_tokens: 1}}},
          {type: 'content_block_delta', delta: {type: 'text_delta', text: 'red'}}, {type: 'message_stop'}
        ] : [{candidates: [{index: 0, content: {parts: [{text: 'red'}]}, finishReason: 'STOP'}]}];
        return {ok: true, headers: new Headers({'content-type': 'text/event-stream'}),
          body: (async function*() {yield Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (chatIds.includes(id) ? 'data: [DONE]\n\n' : ''))})()};
      };
      const messages = [{role: 'user', content: 'first', images: [image]}, {role: 'assistant', content: 'red'},
        {role: 'user', content: '', images: [image]}];
      const deltas = [];
      const result = await client.generate({messages}, streaming ? {onText: text => deltas.push(text)} : {});
      assert.equal(result.text, 'red');
      if (streaming) assert.deepEqual(deltas, ['red']);
      for (const unsupported of providers.get(id).models.filter(item => item.capabilities.includes('text') && !item.capabilities.includes('vision'))) {
        await assert.rejects(client.generate({model: unsupported.id, messages}), /不支持图片/);
      }
      assert.equal(calls, 1);
    });
}

for (const metadata of [{capabilities: ['completion']}, {}, {capabilities: 'vision'}]) {
  test('Ollama refuses images without a confirmed vision capability: ' + JSON.stringify(metadata), async() => {
    const calls = [];
    await assert.rejects(require('../packages/ai-provider-ollama/lib/client').generate({
      request: {model: 'text-only', messages: [{role: 'user', content: '', images: [{data: 'YWJj'}]}]},
      vision: {inputs: message => message.images},
      fetchImpl: async(url, init) => {
        calls.push(url);
        assert.deepEqual(JSON.parse(init.body), {model: 'text-only'});
        return {ok: true, json: async() => metadata};
      }
    }), /不支持图片输入/);
    assert.deepEqual(calls, ['http://127.0.0.1:11434/api/show']);
  });
}
test('Ollama fails closed on capability lookup failure and forwards cancellation', async() => {
  const controller = new AbortController();
  await assert.rejects(require('../packages/ai-provider-ollama/lib/client').generate({
    signal: controller.signal,
    request: {model: 'vision', messages: [{role: 'user', content: '', images: [{data: 'YWJj'}]}]},
    vision: {inputs: message => message.images},
    fetchImpl: async(url, init) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/show');
      assert.equal(init.signal, controller.signal);
      return {ok: false, status: 404};
    }
  }), /无法确认.*404/);
});
test('Grok rejects unsupported WebP before sending any image bytes', async() => {
  await assert.rejects(require('../packages/ai-provider-grok/lib/client').generate({
    apiKey: 'test', request: {model: 'grok-4.6', messages: [{role: 'user', content: '',
      images: [{mimeType: 'image/webp', data: 'YWJj'}]}]},
    vision: {inputs: message => message.images},
    fetchImpl: async() => assert.fail('must not send unsupported images')
  }), /PNG\/JPEG/);
});
test('DeepSeek preserves tool calls and tool results alongside vision history', async() => {
  const image = {mimeType: 'image/jpeg', data: 'YWJj'};
  const messages = [{role: 'user', content: 'Describe', images: [image]},
    {role: 'assistant', content: '', toolCalls: [{id: 'call-1', name: 'posts.list', input: {limit: 1}}]},
    {role: 'tool', content: '[]', toolCallId: 'call-1'}];
  await require('../packages/ai-provider-deepseek/lib/client').generate({
    apiKey: 'test', request: {model: 'deepseek-flash', messages},
    vision: {inputs: message => message.images},
    fetchImpl: async(url, init) => {
      const sent = JSON.parse(init.body).messages;
      assert.deepEqual(sent[0].content, [{type: 'text', text: 'Describe'},
        {type: 'image_url', image_url: {url: 'data:image/jpeg;base64,YWJj'}}]);
      assert.deepEqual(sent[1].tool_calls, [{id: 'call-1', type: 'function',
        function: {name: 'posts__list', arguments: '{"limit":1}'}}]);
      assert.deepEqual(sent[2], {role: 'tool', content: '[]', tool_call_id: 'call-1'});
      return {ok: true, json: async() => ({choices: [{message: {content: 'red'}}]})};
    }
  });
});
