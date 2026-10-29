'use strict';
const images = require('./images');

function baseUrl(accountId) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || '')) throw new TypeError('Cloudflare Account ID is required');
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

async function generate({apiKey, accountId, request, signal, fetchImpl = fetch, reportUsage = () => {}}) {
  if (!apiKey) throw new Error('Cloudflare API token is not configured');
  if (!request.model) throw new TypeError('Cloudflare model ID is required');
  if (request.capability === 'image') return generateImage({apiKey, accountId, request, signal, fetchImpl, reportUsage});
  const response = await fetchImpl(`${baseUrl(accountId)}/chat/completions`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      model: request.model, messages: request.messages.map(message => ({
        role: message.role, content: message.content
      })), stream: false,
      ...(request.maxOutputTokens ? {max_tokens: request.maxOutputTokens} : {})
    })
  });
  reportUsage(undefined, response);
  if (!response.ok) throw new Error('Cloudflare request failed (HTTP ' + response.status + ')');
  const payload = await response.json();
  reportUsage(payload.usage, response);
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('Cloudflare returned no text output');
  return {text: output, provider: 'cloudflare', model: request.model, usage: payload.usage || undefined};
}

module.exports = {baseUrl, generate};

async function generateImage({apiKey, accountId, request, signal, fetchImpl, reportUsage}) {
  const refs = images.inputs(request, 4);
  const body = new FormData();
  body.set('prompt', images.prompt(request));
  body.set('width', '512'); body.set('height', '512');
  refs.forEach((ref, i) => body.append(`input_image_${i}`, new Blob([Buffer.from(ref.data, 'base64')], {type: ref.mimeType}), `reference-${i}.${ref.mimeType.split('/')[1]}`));
  const endpoint = baseUrl(accountId).replace(/\/ai\/v1$/, '/ai/run/');
  const response = await fetchImpl(`${endpoint}${request.model}`, {method: 'POST', signal,
    headers: {Authorization: `Bearer ${apiKey}`}, body});
  reportUsage(undefined, response);
  const payload = await response.json(); reportUsage(payload.usage, response);
  if (!response.ok || payload.success === false) throw new Error(`Cloudflare image request failed (HTTP ${response.status})`);
  return {images: [images.image({mimeType: 'image/jpeg', data: payload.result?.image})], provider: 'cloudflare', model: request.model, usage: payload.usage};
}
