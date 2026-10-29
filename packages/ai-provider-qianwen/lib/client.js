'use strict';

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('通义千问 base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, imageBaseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, images}) {
  if (!apiKey) throw new Error('通义千问 API key is not configured');
  if (!request.model) throw new TypeError('通义千问 model ID is required');
  if (request.capability === 'image') return generateImage({apiKey, baseUrl, imageBaseUrl, request, signal, fetchImpl, reportUsage, images});
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
  if (!response.ok) throw new Error('通义千问 request failed (HTTP ' + response.status + ')');
  const payload = await response.json();
  reportUsage(payload.usage, response);
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('通义千问 returned no text output');
  return {text: output, provider: 'qianwen', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};

async function generateImage({apiKey, baseUrl, imageBaseUrl, request, signal, fetchImpl, reportUsage, images}) {
  if (!images) throw new Error('Image generation requires updated Firekylin core');
  const refs = images.inputs(request, 3);
  const endpoint = imageBaseUrl ? normalizeBaseUrl(imageBaseUrl) : normalizeBaseUrl(baseUrl).replace(/\/compatible-mode\/v1$/, '/api/v1');
  const response = await fetchImpl(`${endpoint}/services/aigc/multimodal-generation/generation`, {
    method: 'POST', signal, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({model: request.model, input: {messages: [{role: 'user', content: [
      ...refs.map(ref => ({image: images.uri(ref)})), {text: images.prompt(request)}]}]}, parameters: {n: 1, watermark: false}})
  });
  reportUsage(undefined, response);
  const payload = await response.json(); reportUsage(payload.usage, response);
  if (!response.ok || payload.code) throw new Error(`通义千问 image request failed (HTTP ${response.status})`);
  const urls = (payload.output?.choices || []).flatMap(choice => choice.message?.content || []).filter(part => part.image).map(part => part.image);
  if (!urls.length) throw new Error('通义千问 returned no image output');
  const output = [];
  for (const address of urls) {
    // Only download the provider's signed image outputs; never forward API credentials.
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)) throw new Error('Invalid Qwen image output URL');
    const file = await fetchImpl(url.toString(), {signal, redirect: 'error'});
    const mimeType = file.headers.get('content-type')?.split(';')[0];
    if (!file.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('Invalid Qwen image download');
    const chunks = []; let size = 0;
    for await (const chunk of file.body) {
      size += chunk.length;
      if (size > 20000000) throw new Error('Qwen image output too large');
      chunks.push(chunk);
    }
    output.push(images.image({mimeType, data: Buffer.concat(chunks).toString('base64')}));
  }
  return {images: output, provider: 'qianwen', model: request.model, usage: payload.usage};
}
