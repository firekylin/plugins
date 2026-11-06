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
  let text = '', usage, finishReason;
  for await (const raw of records(response.body)) {
    if (raw === '[DONE]') {
      if (finishReason && finishReason !== 'stop') throw new Error('Provider stream incomplete');
      return {choices: [{message: {content: text}}], usage};
    }
    const event = JSON.parse(raw);
    if (event.usage) {usage = event.usage; reportUsage(usage, response)}
    if (event.error) throw new Error('Provider stream failed');
    const choice = event.choices?.find(item => item.index === 0 || item.index === undefined);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    text = append(text, choice?.delta?.content, onText);
  }
  throw new Error('Stream interrupted');
}

module.exports = {readStream};
