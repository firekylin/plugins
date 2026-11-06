'use strict';

// A fresh adapter for every request; transport, limits and callbacks belong to core.
module.exports = function createParser() {
  let usage, stopReason;
  return {format: 'sse', parse(raw) {
    const event = JSON.parse(raw);
    const update = {};
    if (event.type === 'message_start') usage = event.message?.usage;
    if (event.type === 'message_delta' && event.usage) usage = {...usage, ...event.usage};
    if (event.type === 'message_start' || event.usage) update.usage = usage;
    if (event.error || event.type === 'error') return {...update, error: 'Anthropic stream failed'};
    if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') update.text = event.content_block.text;
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') update.text = event.delta.text;
    if (event.type === 'message_stop') {
      if (stopReason && !['end_turn', 'stop_sequence'].includes(stopReason)) {
        return {...update, error: 'Anthropic stream incomplete'};
      }
      update.done = true;
      update.stop = true;
    }
    return update;
  }};
};
