'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const corePath = process.env.FIREKYLIN_CORE_PATH;
const ids = ['openai', 'anthropic', 'google-gemini'];
for (const id of ids) {
  test(`${id}: rejects image messages on old core rather than silently dropping them`, async() => {
    const generate = require(`../packages/ai-provider-${id}/lib/client`).generate;
    let called = false;
    await assert.rejects(generate({apiKey: 'test', request: {model: 'test', messages: [
      {role: 'user', content: '', images: [{mimeType: 'image/png', data: 'YWJj'}]}]},
    fetchImpl: async() => {called = true}}), /vision API/);
    assert.equal(called, false);
  });
  for (const streaming of [false, true]) test(`${id}: registered provider sends image-only and historical images through real core (${streaming ? 'stream' : 'JSON'})`,
    {skip: !corePath}, async t => {
      const AIClient = require(path.join(corePath, 'src/ai/client'));
      const Registry = require(path.join(corePath, 'src/ai/registry'));
      const sharp = require(path.join(corePath, 'node_modules/sharp'));
      const bytes = await sharp({create: {width: 2, height: 2, channels: 3, background: '#ff0000'}}).png().toBuffer();
      const image = {mimeType: 'image/png', data: bytes.toString('base64')};
      const providers = new Registry();
      await require(`../packages/ai-provider-${id}/plugin`).register({
        ai: {credentials: {get: async name => name === 'apiKey' ? 'test' : undefined, has: async() => true},
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
      global.fetch = async(_, init) => {
        calls++;
        const body = JSON.parse(init.body);
        const user = (body.input || body.messages || body.contents).filter(item => item.role === 'user');
        assert.equal(user.length, 2);
        for (const item of user) {
          const parts = item.content || item.parts;
          assert.ok(Array.isArray(parts));
          if (id === 'openai') assert.deepEqual(parts.find(part => part.type === 'input_image'),
            {type: 'input_image', image_url: `data:image/png;base64,${image.data}`});
          if (id === 'anthropic') assert.deepEqual(parts.find(part => part.type === 'image'),
            {type: 'image', source: {type: 'base64', media_type: 'image/png', data: image.data}});
          if (id === 'google-gemini') assert.deepEqual(parts.find(part => part.inlineData), {inlineData: image});
        }
        if (!streaming) return {ok: true, json: async() => ({output_text: 'red', content: [{type: 'text', text: 'red'}],
          candidates: [{content: {parts: [{text: 'red'}]}}]})};
        const events = id === 'openai' ? [
          {type: 'response.output_text.delta', delta: 'red'}, {type: 'response.completed', response: {status: 'completed', output: [{content: [{type: 'output_text', text: 'red'}]}]}}
        ] : id === 'anthropic' ? [
          {type: 'message_start', message: {usage: {input_tokens: 1}}},
          {type: 'content_block_delta', delta: {type: 'text_delta', text: 'red'}}, {type: 'message_stop'}
        ] : [{candidates: [{index: 0, content: {parts: [{text: 'red'}]}, finishReason: 'STOP'}]}];
        return {ok: true, headers: new Headers({'content-type': 'text/event-stream'}),
          body: (async function*() {yield Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))})()};
      };
      const messages = [{role: 'user', content: 'first', images: [image]}, {role: 'assistant', content: 'red'},
        {role: 'user', content: '', images: [image]}];
      const deltas = [];
      const result = await client.generate({messages}, streaming ? {onText: text => deltas.push(text)} : {});
      assert.equal(result.text, 'red');
      if (streaming) assert.deepEqual(deltas, ['red']);
      if (id !== 'openai') await assert.rejects(client.generate({model: 'custom', messages}), /不支持图片/);
      assert.equal(calls, 1);
    });
}
