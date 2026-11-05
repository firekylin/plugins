'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {generate} = require('../lib/client');
test('round trips function calls, tool outputs and encrypted reasoning', async() => {
  let body;
  const result = await generate({apiKey: 'test', request: {model: 'model', tools: [{name: 'posts.publish', description: 'publish', inputSchema: {type: 'object'}}],
    messages: [{role: 'assistant', content: '', providerData: {openai: [{type: 'reasoning', encrypted_content: 'opaque'}]},
      toolCalls: [{id: 'call-1', name: 'posts.publish', input: {id: 1}}]},
    {role: 'tool', toolCallId: 'call-1', content: '{"status":3}'}]}, fetchImpl: async(_, options) => {
    body = JSON.parse(options.body);
    return {ok: true, json: async() => ({output: [{type: 'function_call', call_id: 'call-2', name: 'posts__get_managed', arguments: '{"id":1}'}]})};
  }});
  assert.equal(body.input[0].type, 'reasoning');
  assert.equal(body.input[1].name, 'posts__publish');
  assert.equal(body.input[2].type, 'function_call_output');
  assert.equal(body.tools[0].name, 'posts__publish');
  assert.equal(body.parallel_tool_calls, false);
  assert.deepEqual(result.toolCalls, [{id: 'call-2', name: 'posts.get_managed', input: {id: 1}}]);
});
test('streams text, reports final usage, and rejects incomplete streams', async() => {
  const chunks = [];
  const events = [
    {type: 'response.output_text.delta', delta: '你好'},
    {type: 'response.completed', response: {output_text: '你好', usage: {output_tokens: 2}}}
  ];
  const call = (complete = true) => generate({apiKey: 'test', request: {model: 'model', messages: [{role: 'user', content: 'hi'}]},
    onText: text => chunks.push(text), fetchImpl: async() => ({ok: true,
      headers: new Headers({'content-type': 'text/event-stream'}),
      body: (async function*() {
        const bytes = new TextEncoder().encode(events.slice(0, complete ? 2 : 1).map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
        yield bytes.slice(0, 17); yield bytes.slice(17);
      })()})});
  const result = await call();
  assert.equal(result.text, '你好');
  assert.deepEqual(chunks, ['你好']);
  assert.equal(result.usage.output_tokens, 2);
  await assert.rejects(call(false), /interrupted/);
});
