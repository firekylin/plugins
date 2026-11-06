'use strict';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError('Ollama requires HTTPS or a loopback HTTP URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, streamResponse, onText, vision}) {
  if (!request.model) throw new TypeError('Ollama model ID is required');
  if (onText && request.capability !== 'image' && !streamResponse) throw new Error('Streaming requires updated Firekylin core (streamResponse API)');
  const messages = request.messages.map(message => {
    if (!message.images?.length) return {role: message.role, content: message.content};
    if (!vision?.inputs) throw new Error('Image understanding requires updated Firekylin core (vision API)');
    return {role: message.role, content: message.content, images: vision.inputs(message).map(image => image.data)};
  });
  if (messages.some(message => message.images?.length)) {
    const details = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/show`, {
      method: 'POST', signal, headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: request.model})
    });
    if (!details.ok) throw new Error('无法确认 Ollama 模型的图片输入能力 (HTTP ' + details.status + ')');
    const metadata = await details.json();
    if (!Array.isArray(metadata.capabilities) || !metadata.capabilities.includes('vision')) {
      throw new Error('当前 Ollama 模型不支持图片输入，请配置视觉模型后重试');
    }
  }
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/chat`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: request.model, messages, stream: Boolean(onText),
      ...(request.maxOutputTokens ? {options: {num_predict: request.maxOutputTokens}} : {})
    })
  });
  reportUsage(undefined, response);
  if (!response.ok) throw new Error('Ollama request failed (HTTP ' + response.status + ')');
  if (onText) return {...streamResponse(response, 'ollama'), provider: 'ollama', model: request.model};
  const payload = await response.json();
  reportUsage(payload, response);
  const output = payload.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('Ollama returned no text output');
  const usage = {prompt_tokens: payload.prompt_eval_count ?? null, completion_tokens: payload.eval_count ?? null,
    total_tokens: Number.isSafeInteger(payload.prompt_eval_count) && payload.prompt_eval_count >= 0 &&
      Number.isSafeInteger(payload.eval_count) && payload.eval_count >= 0 &&
      Number.isSafeInteger(payload.prompt_eval_count + payload.eval_count) ? payload.prompt_eval_count + payload.eval_count : null};
  return {text: output, provider: 'ollama', model: request.model, usage};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
