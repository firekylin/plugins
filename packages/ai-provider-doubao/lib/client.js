'use strict';
const images = require('./images');

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('豆包 base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}}) {
  if (!apiKey) throw new Error('豆包 API key is not configured');
  if (!request.model) throw new TypeError('豆包 model ID is required');
  if (request.capability === 'image') return generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage});
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
  reportUsage(undefined, response);
  if (!response.ok) throw new Error('豆包 request failed (HTTP ' + response.status + ')');
  const payload = await response.json();
  reportUsage(payload.usage, response);
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('豆包 returned no text output');
  return {text: output, provider: 'doubao', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};

async function generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage}) {
  const refs = images.inputs(request, 14);
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/images/generations`, {
    method: 'POST', signal, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({model: request.model, prompt: images.prompt(request), response_format: 'b64_json', size: '2K',
      sequential_image_generation: 'disabled', watermark: false, ...(refs.length ? {image: refs.map(images.uri)} : {})})
  });
  reportUsage(undefined, response);
  const payload = await response.json(); reportUsage(payload.usage, response);
  if (!response.ok) throw new Error(`豆包 image request failed (HTTP ${response.status})`);
  return {images: images.output(payload, 'image/jpeg'), provider: 'doubao', model: request.model, usage: payload.usage};
}
