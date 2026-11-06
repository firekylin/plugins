'use strict';

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('小米 MiMo base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, streamResponse, onText, vision}) {
  if (!apiKey) throw new Error('小米 MiMo API key is not configured');
  if (!request.model) throw new TypeError('小米 MiMo model ID is required');
  if (onText && request.capability !== 'image' && !streamResponse) throw new Error('Streaming requires updated Firekylin core (streamResponse API)');
  const content = message => {
    if (!message.images?.length) return message.content;
    if (!vision?.inputs) throw new Error('Image understanding requires updated Firekylin core (vision API)');
    const inputs = vision.inputs(message);
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
  if (!response.ok) throw new Error('小米 MiMo request failed (HTTP ' + response.status + ')');
  if (onText) return {...streamResponse(response, 'chat-completions'), provider: 'xiaomi-mimo', model: request.model};
  const payload = await response.json();
  reportUsage(payload.usage, response);
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('小米 MiMo returned no text output');
  return {text: output, provider: 'xiaomi-mimo', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
