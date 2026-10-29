'use strict';

const DEFAULT_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Vercel AI Gateway base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, images}) {
  if (!apiKey) throw new Error('Vercel AI Gateway API key is not configured');
  if (!request.model) throw new TypeError('Vercel AI Gateway model ID is required');
  if (request.capability === 'image') return generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage, images});
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
  if (!response.ok) throw new Error('Vercel AI Gateway request failed (HTTP ' + response.status + ')');
  const payload = await response.json();
  reportUsage(payload.usage, response);
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('Vercel AI Gateway returned no text output');
  return {text: output, provider: 'vercel-ai-gateway', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};

async function generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage, images}) {
  if (!images) throw new Error('Image generation requires updated Firekylin core');
  const refs = images.inputs(request, 14);
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: 'POST', signal, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({model: request.model, modalities: ['text', 'image'], stream: false,
      messages: [{role: 'user', content: [{type: 'text', text: images.prompt(request)},
        ...refs.map(ref => ({type: 'image_url', image_url: {url: images.uri(ref)}}))]}]})
  });
  reportUsage(undefined, response);
  const payload = await response.json(); reportUsage(payload.usage, response);
  if (!response.ok) throw new Error(`Vercel image request failed (HTTP ${response.status})`);
  const output = (payload.choices?.[0]?.message?.images || []).map(value => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(value.image_url?.url || '');
    return images.image(match && {mimeType: match[1], data: match[2]});
  });
  if (!output.length) throw new Error('Vercel returned no image output');
  return {images: output, provider: 'vercel-ai-gateway', model: request.model, usage: payload.usage};
}
