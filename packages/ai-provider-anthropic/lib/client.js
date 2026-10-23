'use strict';
const {metadata, failure} = require('./usage');

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Anthropic base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch}) {
  if (!apiKey) throw new Error('Anthropic API key is not configured');
  if (!request.model) throw new TypeError('Anthropic model ID is required');
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  const messages = request.messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content
  }));
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/messages`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01'},
    body: JSON.stringify({
      model: request.model, messages, max_tokens: request.maxOutputTokens || 2048,
      ...(system ? {system} : {})
    })
  });
  if (!response.ok) throw failure('Anthropic request failed (HTTP ' + response.status + ')', response);
  const payload = await response.json();
  const output = (payload.content || []).filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text).join('\n');
  if (typeof output !== 'string' || !output.trim()) throw failure('Anthropic returned no text output', response, payload.usage, 'anthropic');
  return {text: output, provider: 'anthropic', model: request.model, usage: payload.usage || undefined, ...metadata(payload.usage, response, 'anthropic')};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
