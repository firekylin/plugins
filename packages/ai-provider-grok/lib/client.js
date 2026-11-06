'use strict';

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Grok base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, streamResponse, onText, images, vision}) {
  if (!apiKey) throw new Error('Grok API key is not configured');
  if (!request.model) throw new TypeError('Grok model ID is required');
  if (request.capability === 'image') return generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage, images});
  if (onText && request.capability !== 'image' && !streamResponse) throw new Error('Streaming requires updated Firekylin core (streamResponse API)');
  const content = message => {
    if (!message.images?.length) return message.content;
    if (!vision?.inputs) throw new Error('Image understanding requires updated Firekylin core (vision API)');
    const inputs = vision.inputs(message);
    if (inputs.some(image => !['image/png', 'image/jpeg'].includes(image.mimeType))) {
      throw new Error('Grok 图片理解仅支持 PNG/JPEG，请转换图片后重试');
    }
    return [...(message.content ? [{type: 'text', text: message.content}] : []),
      ...inputs.map(image => ({type: 'image_url', image_url: {url: `data:${image.mimeType};base64,${image.data}`}}))];
  };
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      model: request.model,
      messages: request.messages.map(message => ({role: message.role, content: content(message)})),
      stream: Boolean(onText),
      ...(onText ? {stream_options: {include_usage: true}} : {}),
      ...(request.maxOutputTokens ? {max_tokens: request.maxOutputTokens} : {})
    })
  });
  reportUsage(undefined, response);
  if (!response.ok) throw new Error('Grok request failed (HTTP ' + response.status + ')');
  if (onText) return {...streamResponse(response, 'chat-completions'), provider: 'grok', model: request.model};
  const payload = await response.json();
  reportUsage(payload.usage, response);
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('Grok returned no text output');
  return {text: output, provider: 'grok', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};

async function generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage, images}) {
  if (!images) throw new Error('Image generation requires updated Firekylin core');
  const refs = images.inputs(request);
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/images/${refs.length ? 'edits' : 'generations'}`, {
    method: 'POST', signal, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({model: request.model, prompt: images.prompt(request), n: 1, response_format: 'b64_json',
      ...(refs.length ? {image: {url: images.uri(refs[0]), type: 'image_url'}} : {})})
  });
  reportUsage(undefined, response);
  const payload = await response.json(); reportUsage(payload.usage, response);
  if (!response.ok) throw new Error(`Grok image request failed (HTTP ${response.status})`);
  return {images: images.output(payload, 'image/jpeg'), provider: 'grok', model: request.model, usage: payload.usage};
}
