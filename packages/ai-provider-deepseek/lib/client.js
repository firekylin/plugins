'use strict';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:') throw new TypeError('DeepSeek base URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new TypeError('Invalid DeepSeek base URL');
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, streamResponse, onText}) {
  if (!apiKey) throw new Error('DeepSeek API key is not configured');
  if (onText && request.capability !== 'image' && !streamResponse) throw new Error('Streaming requires updated Firekylin core (streamResponse API)');
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      model: request.model,
      messages: request.messages.map(message => ({role: message.role, content: message.content,
        ...(message.toolCallId ? {tool_call_id: message.toolCallId} : {}),
        ...(message.toolCalls ? {tool_calls: message.toolCalls.map(call => ({id: call.id, type: 'function',
          function: {name: call.name.replace(/\./g, '__'), arguments: JSON.stringify(call.input)}}))} : {})})),
      ...(request.tools?.length ? {tools: request.tools.map(tool => ({type: 'function', function: {
        name: tool.name.replace(/\./g, '__'), description: tool.description, parameters: tool.inputSchema}}))} : {}),
      stream: Boolean(onText),
      ...(onText ? {stream_options: {include_usage: true}} : {}),
      ...(request.disableThinking === true || request.tools?.length ? {thinking: {type: 'disabled'}} : {}),
      ...(request.maxOutputTokens ? {max_tokens: request.maxOutputTokens} : {})
    })
  });
  reportUsage(undefined, response);
  if (!response.ok) throw new Error(`DeepSeek request failed (HTTP ${response.status})`);
  let payload;
  if (onText && response.headers?.get('content-type')?.includes('text/event-stream')) {
    return {...streamResponse(response, 'chat-completions'), provider: 'deepseek', model: request.model};
  } else payload = await response.json();
  reportUsage(payload.usage, response);
  const finishReason = payload.choices?.[0]?.finish_reason;
  if (finishReason && !['stop', 'tool_calls'].includes(finishReason)) throw new Error('DeepSeek response incomplete');
  const output = payload.choices?.[0]?.message?.content;
  const toolCalls = (payload.choices?.[0]?.message?.tool_calls || []).map(call => ({
    id: call.id, name: call.function.name.replace(/__/g, '.'), input: JSON.parse(call.function.arguments)
  }));
  if (!toolCalls.length && (typeof output !== 'string' || !output.trim())) throw new Error('DeepSeek returned no text output');
  return {text: output || '', ...(toolCalls.length ? {toolCalls} : {}), provider: 'deepseek', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
