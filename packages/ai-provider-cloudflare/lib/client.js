'use strict';
const {metadata, failure} = require('./usage');

function baseUrl(accountId) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || '')) throw new TypeError('Cloudflare Account ID is required');
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

async function generate({apiKey, accountId, request, signal, fetchImpl = fetch}) {
  if (!apiKey) throw new Error('Cloudflare API token is not configured');
  if (!request.model) throw new TypeError('Cloudflare model ID is required');
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
  if (!response.ok) throw failure('Cloudflare request failed (HTTP ' + response.status + ')', response);
  const payload = await response.json();
  const output = payload.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw failure('Cloudflare returned no text output', response, payload.usage);
  return {text: output, provider: 'cloudflare', model: request.model, usage: payload.usage || undefined, ...metadata(payload.usage, response)};
}

module.exports = {baseUrl, generate};
