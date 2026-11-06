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
  let text = '', usageMetadata, complete = false, finishReason;
  for await (const raw of records(response.body)) {
    const event = JSON.parse(raw);
    if (event.usageMetadata) {usageMetadata = event.usageMetadata; reportUsage(usageMetadata, response)}
    if (event.error || event.promptFeedback?.blockReason) throw new Error('Gemini stream failed');
    const candidate = event.candidates?.find(item => item.index === 0 || item.index === undefined);
    for (const part of candidate?.content?.parts || []) {
      if (!part.thought) text = append(text, part.text, onText);
    }
    if (candidate?.finishReason && candidate.finishReason !== 'FINISH_REASON_UNSPECIFIED') {complete = true; finishReason = candidate.finishReason}
  }
  if (!complete) throw new Error('Gemini stream interrupted');
  if (finishReason !== 'STOP') throw new Error('Gemini stream incomplete');
  return {candidates: [{content: {parts: [{text}]}}], usageMetadata};
}

module.exports = {readStream};
