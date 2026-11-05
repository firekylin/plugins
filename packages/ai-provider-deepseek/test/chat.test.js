'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {generate} = require('../lib/client');
test('streams fragmented tool arguments and sends normalized tool results', async() => {
  let body;
  const frames = [
    {choices: [{delta: {tool_calls: [{index: 0, id: 'call', function: {name: 'posts__publish', arguments: '{"id":'}}]}}]},
    {choices: [{delta: {tool_calls: [{index: 0, function: {arguments: '1}'}}]}}]},
    {choices: [], usage: {completion_tokens: 2}}
  ];
  const result = await generate({apiKey: 'test', request: {model: 'model', messages: [
    {role: 'assistant', content: '', toolCalls: [{id: 'previous', name: 'posts.get_managed', input: {id: 1}}]},
    {role: 'tool', toolCallId: 'previous', content: '{}'}],
    tools: [{name: 'posts.publish', description: 'publish', inputSchema: {type: 'object'}}]}, onText() {},
    fetchImpl: async(_, options) => {
      body = JSON.parse(options.body);
      return {ok: true, headers: new Headers({'content-type': 'text/event-stream'}), body: (async function*() {
        for (const event of frames) yield new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
        yield new TextEncoder().encode('data: [DONE]\n\n');
      })()};
    }});
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.messages[1].tool_call_id, 'previous');
  assert.equal(body.messages[0].tool_calls[0].function.name, 'posts__get_managed');
  assert.equal(body.tools[0].function.name, 'posts__publish');
  assert.deepEqual(result.toolCalls, [{id: 'call', name: 'posts.publish', input: {id: 1}}]);
  assert.equal(result.usage.completion_tokens, 2);
});
