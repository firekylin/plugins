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
  let text = '';
  for await (const raw of records(response.body, true)) {
    const event = JSON.parse(raw);
    if (event.done || event.prompt_eval_count !== undefined || event.eval_count !== undefined) reportUsage(event, response);
    if (event.error) throw new Error('Ollama stream failed');
    text = append(text, event.message?.content, onText);
    if (event.done === true) {
      if (event.done_reason && event.done_reason !== 'stop') throw new Error('Ollama stream incomplete');
      return {...event, message: {...event.message, content: text}};
    }
  }
  throw new Error('Ollama stream interrupted');
}

module.exports = {readStream};
