'use strict';
const {metadata, failure} = require('./usage');

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Google Gemini base URL must be an HTTPS URL without credentials or query');
  }
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch}) {
  if (!apiKey) throw new Error('Google Gemini API key is not configured');
  if (!request.model) throw new TypeError('Google Gemini model ID is required');
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  const contents = request.messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user', parts: [{text: message.content}]
  }));
  const image = request.capability === 'image';
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/models/${encodeURIComponent(request.model)}:generateContent`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
    body: JSON.stringify({
      contents, ...(system ? {systemInstruction: {parts: [{text: system}]}} : {}),
      generationConfig: image ? {responseModalities: ['IMAGE']} : {maxOutputTokens: request.maxOutputTokens || 2048}
    })
  });
  if (!response.ok) throw failure('Google Gemini request failed (HTTP ' + response.status + ')', response);
  const payload = await response.json();
  const parts = payload.candidates?.[0]?.content?.parts || [];
  const usage = payload.usageMetadata ? {prompt_tokens: payload.usageMetadata.promptTokenCount ?? null, completion_tokens: payload.usageMetadata.candidatesTokenCount ?? null, total_tokens: payload.usageMetadata.totalTokenCount ?? null} : undefined;
  if (image) {
    const images = parts.filter(part => part.inlineData?.mimeType?.startsWith('image/') && part.inlineData.data)
      .map(part => ({mimeType: part.inlineData.mimeType, data: part.inlineData.data}));
    if (!images.length) throw failure('Google Gemini returned no image output', response, payload.usageMetadata, 'gemini');
    return {images, provider: 'google-gemini', model: request.model, usage, ...metadata(payload.usageMetadata, response, 'gemini')};
  }
  const output = parts
    .filter(item => typeof item.text === 'string').map(item => item.text).join('\n');
  if (typeof output !== 'string' || !output.trim()) throw failure('Google Gemini returned no text output', response, payload.usageMetadata, 'gemini');
  return {text: output, provider: 'google-gemini', model: request.model, usage, ...metadata(payload.usageMetadata, response, 'gemini')};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
