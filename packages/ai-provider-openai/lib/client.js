'use strict';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function outputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  return (payload.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text).join('\n');
}

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('OpenAI base URL must use HTTP or HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new TypeError('Invalid OpenAI base URL');
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, streamResponse, images, onText, vision}) {
  if (!apiKey) throw new Error('OpenAI API key is not configured');
  if (request.capability === 'image') return generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage, images});
  if (onText && request.capability !== 'image' && !streamResponse) throw new Error('Streaming requires updated Firekylin core (streamResponse API)');
  const inputImages = message => {
    if (!message.images?.length) return [];
    if (!vision?.inputs) throw new Error('Image understanding requires updated Firekylin core (vision API)');
    return vision.inputs(message);
  };
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/responses`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      model: request.model,
      ...(request.tools?.length ? {store: false, include: ['reasoning.encrypted_content']} : {}),
      input: request.messages.flatMap(message => message.role === 'tool'
        ? [{type: 'function_call_output', call_id: message.toolCallId, output: message.content}]
        : [...(message.providerData?.openai || []), ...((message.content || message.images?.length) ? [{role: message.role, content: message.images?.length ? [
            ...(message.content ? [{type: 'input_text', text: message.content}] : []),
            ...inputImages(message).map(image => ({type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}`}))
          ] : message.content}] : []),
          ...(message.toolCalls || []).map(call => ({type: 'function_call', call_id: call.id,
            name: call.name.replace(/\./g, '__'), arguments: JSON.stringify(call.input)}))]),
      ...(request.tools?.length ? {tools: request.tools.map(tool => ({type: 'function',
        name: tool.name.replace(/\./g, '__'), description: tool.description, parameters: tool.inputSchema,
        strict: false})), parallel_tool_calls: false} : {}),
      ...(onText ? {stream: true} : {}),
      ...(request.reasoningEffort ? {reasoning: {effort: request.reasoningEffort}} : {}),
      ...(request.maxOutputTokens ? {max_output_tokens: request.maxOutputTokens} : {})
    })
  });
  reportUsage(undefined, response);
  let payload;
  if (onText && response.ok && response.headers?.get('content-type')?.includes('text/event-stream')) {
    return {...streamResponse(response, 'responses'), provider: 'openai', model: request.model};
  } else payload = await response.json().catch(() => ({}));
  reportUsage(payload.usage, response);
  if (!response.ok) {
    const message = payload.error && payload.error.message ? payload.error.message : `HTTP ${response.status}`;
    throw new Error(`OpenAI request failed: ${message}`);
  }
  if (['incomplete', 'failed'].includes(payload.status)) throw new Error('OpenAI response incomplete');
  const text = outputText(payload);
  const toolCalls = (payload.output || []).filter(item => item.type === 'function_call').map(item => ({
    id: item.call_id, name: item.name.replace(/__/g, '.'), input: JSON.parse(item.arguments)
  }));
  if (!text && !toolCalls.length) throw new Error('OpenAI returned no text output');
  return {text, ...(toolCalls.length ? {toolCalls, providerData: {openai: (payload.output || []).filter(item => item.type === 'reasoning')}} : {}), provider: 'openai', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, outputText, generate};

async function generateImage({apiKey, baseUrl, request, signal, fetchImpl, reportUsage, images}) {
  if (!images) throw new Error('Image generation requires updated Firekylin core');
  const refs = images.inputs(request, 16);
  const headers = {Authorization: `Bearer ${apiKey}`};
  let body;
  if (refs.length) {
    body = new FormData();
    body.set('model', request.model); body.set('prompt', images.prompt(request)); body.set('n', '1');
    body.set('output_format', 'png');
    refs.forEach((ref, i) => body.append('image[]', new Blob([Buffer.from(ref.data, 'base64')], {type: ref.mimeType}), `reference-${i}.${ref.mimeType.split('/')[1]}`));
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({model: request.model, prompt: images.prompt(request), n: 1, output_format: 'png'});
  }
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/images/${refs.length ? 'edits' : 'generations'}`, {method: 'POST', signal, headers, body});
  reportUsage(undefined, response);
  const payload = await response.json();
  reportUsage(payload.usage, response);
  if (!response.ok) throw new Error(`OpenAI image request failed (HTTP ${response.status})`);
  return {images: images.output(payload, 'image/png'), provider: 'openai', model: request.model, usage: payload.usage};
}
