'use strict';

// Bundled in each independently published provider; keep copies in sync.
// Decode before splitting: UTF-8 characters and CRLF may span network chunks.
async function* records(body, ndjson = false) {
  if (!body) throw new Error('Missing stream body');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let buffer = '', data = [], dataSize = 0;
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, {stream: true});
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.length > 2000000) throw new Error('Stream frame too large');
      if (ndjson) {
        if (line.trim()) yield line;
      } else if (line === '') {
        if (data.length) yield data.join('\n');
        data = []; dataSize = 0;
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
        dataSize += line.length;
      }
      if (dataSize > 2000000) throw new Error('Stream frame too large');
    }
    if (buffer.length > 2000000) throw new Error('Stream frame too large');
  }
  buffer += decoder.decode();
  if (ndjson && buffer.trim()) yield buffer;
  // SSE dispatch requires a blank line. A trailing partial event is truncation.
  else if (buffer.trim() || data.length) throw new Error('Stream interrupted');
}

function append(text, delta, onText) {
  if (typeof delta !== 'string' || !delta) return text;
  if (text.length + delta.length > 200000) throw new Error('Stream text too large');
  onText(delta);
  return text + delta;
}

async function readStream(response, onText, reportUsage = () => {}) {
  let text = '', usage, stopReason;
  for await (const raw of records(response.body)) {
    const event = JSON.parse(raw);

    if (event.type === 'message_start') usage = event.message?.usage;
    if (event.type === 'message_delta' && event.usage) usage = {...usage, ...event.usage};
    if (event.type === 'message_start' || event.usage) reportUsage(usage, response);
    if (event.error || event.type === 'error') throw new Error('Anthropic stream failed');
    if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      text = append(text, event.content_block.text, onText);
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text = append(text, event.delta.text, onText);
    }
    if (event.type === 'message_stop') {
      if (stopReason && !['end_turn', 'stop_sequence'].includes(stopReason)) throw new Error('Anthropic stream incomplete');
      return {content: [{type: 'text', text}], usage};
    }
  }
  throw new Error('Anthropic stream interrupted');
}

module.exports = {readStream};
