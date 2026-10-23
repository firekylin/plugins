'use strict';
const {metadata, failure} = require('./usage');

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('通义千问 base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch}) {
  if (!apiKey) throw new Error('通义千问 API key is not configured');
  if (!request.model) throw new TypeError('通义千问 model ID is required');
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      model: request.model,
      messages: request.messages.map(message => ({role: message.role, content: message.content})),
      stream: false,
      ...(request.maxOutputTokens ? {max_tokens: request.maxOutputTokens} : {})
    })
  });
  if (!response.ok) throw failure('通义千问 request failed (HTTP ' + response.status + ')', response);
  const payload = await response.json();
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw failure('通义千问 returned no text output', response, payload.usage);
  return {text: output, provider: 'qianwen', model: request.model, usage: payload.usage || undefined, ...metadata(payload.usage, response)};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
