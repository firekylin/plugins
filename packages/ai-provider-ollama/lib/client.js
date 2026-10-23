'use strict';
const {metadata, failure} = require('./usage');
const {sumTokens} = require('firekylin-ai-provider-utils');

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

async function generate({baseUrl, request, signal, fetchImpl = fetch}) {
  if (!request.model) throw new TypeError('Ollama model ID is required');
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/chat`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: request.model, messages: request.messages.map(message => ({
        role: message.role, content: message.content
      })), stream: false,
      ...(request.maxOutputTokens ? {options: {num_predict: request.maxOutputTokens}} : {})
    })
  });
  if (!response.ok) throw failure('Ollama request failed (HTTP ' + response.status + ')', response);
  const payload = await response.json();
  const output = payload.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw failure('Ollama returned no text output', response, payload);
  const usage = {prompt_tokens: payload.prompt_eval_count ?? null, completion_tokens: payload.eval_count ?? null,
    total_tokens: sumTokens(payload.prompt_eval_count, payload.eval_count)};
  return {text: output, provider: 'ollama', model: request.model, usage, ...metadata(payload, response)};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
