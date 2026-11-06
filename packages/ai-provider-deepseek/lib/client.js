'use strict';

const {records, append} = require('./stream');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:') throw new TypeError('DeepSeek base URL must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new TypeError('Invalid DeepSeek base URL');
  return url.toString().replace(/\/$/, '');
}

async function generate({apiKey, baseUrl, request, signal, fetchImpl = fetch, reportUsage = () => {}, onText}) {
  if (!apiKey) throw new Error('DeepSeek API key is not configured');
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
    let text = '', usage, complete = false, finishReason, toolSize = 0;
    const calls = [];
    for await (const raw of records(response.body)) {
      if (raw === '[DONE]') {complete = true; break}
      const event = JSON.parse(raw);
      if (event.usage) {usage = event.usage; reportUsage(usage, response)}
      if (event.error) throw new Error('DeepSeek stream failed');
      if (event.choices?.[0]?.finish_reason) finishReason = event.choices[0].finish_reason;
      const delta = event.choices?.[0]?.delta || {};
      text = append(text, delta.content, onText);
      for (const call of delta.tool_calls || []) {
        if (!Number.isInteger(call.index) || call.index < 0 || call.index >= 128) throw new Error('Invalid DeepSeek tool index');
        toolSize += (call.id?.length || 0) + (call.function?.name?.length || 0) + (call.function?.arguments?.length || 0);
        if (toolSize > 200000) throw new Error('DeepSeek tool output too large');
        const target = calls[call.index] ||= {id: '', function: {name: '', arguments: ''}};
        if (call.id) target.id = call.id;
        if (call.function?.name) target.function.name += call.function.name;
        if (call.function?.arguments) target.function.arguments += call.function.arguments;
      }
    }
    if (!complete) throw new Error('DeepSeek stream interrupted');
    if (finishReason && !['stop', 'tool_calls'].includes(finishReason)) throw new Error('DeepSeek stream incomplete');
    payload = {usage, choices: [{message: {content: text, tool_calls: calls}}]};
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
