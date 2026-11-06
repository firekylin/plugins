'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
module.exports = id => {
  const {generate} = require(`../../packages/ai-provider-${id}/lib/client`);
  function call(events, reportUsage = () => {}, stream = true) {
    return generate({apiKey: 'test', request: {model: 'test', messages: []}, reportUsage,
      ...(stream ? {onText() {}} : {}), fetchImpl: async() => ({ok: true,
        headers: new Headers({'content-type': 'text/event-stream'}), json: async() => events,
        body: (async function*() {
          for (const event of events) yield new TextEncoder().encode(typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\r\n\r\n`);
        })()})});
  }
  test(`${id}: reports usage before rejecting incomplete responses`, async() => {
    const usage = {output_tokens: 2, completion_tokens: 2};
    const payload = id === 'openai' ? {status: 'incomplete', output_text: 'partial', usage} :
      {choices: [{finish_reason: 'length', message: {content: 'partial'}}], usage};
    const reports = [];
    const events = id === 'openai' ? [{type: 'response.incomplete', response: payload}] :
      [{choices: [{finish_reason: 'length', delta: {content: 'partial'}}]}, {choices: [], usage}, 'data: [DONE]\n\n'];
    await assert.rejects(call(events, raw => reports.push(raw)), /failed|incomplete/);
    assert.deepEqual(reports.at(-1), usage);
    await assert.rejects(call(payload, raw => reports.push(raw), false), /incomplete/);
    assert.deepEqual(reports.at(-1), usage);
    if (id === 'deepseek') {
      await assert.rejects(call(events.slice(0, -1), raw => reports.push(raw)), /interrupted/);
      assert.deepEqual(reports.at(-1), usage);
    }
  });
  test(`${id}: rejects oversized frames with or without delimiters`, async() => {
    for (const suffix of ['', '\n\n']) await assert.rejects(call(['data: ' + 'x'.repeat(2000001) + suffix]), /too large/);
  });
  if (id === 'deepseek') test('deepseek: bounds accumulated tool arguments and indexes', async() => {
    const event = (index, text) => ({choices: [{delta: {tool_calls: [{index, function: {arguments: text}}]}}]});
    await assert.rejects(call([event(0, 'x'.repeat(100001)), event(0, 'y'.repeat(100001))]), /too large/);
    await assert.rejects(call([event(1000000000, '{}')]), /Invalid.*index/);
  });
};
