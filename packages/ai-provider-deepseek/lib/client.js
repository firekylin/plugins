'use strict';

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
    const decoder = new TextDecoder();
    let buffer = '', text = '', usage, complete = false;
    const calls = [];
    for await (const bytes of response.body) {
      buffer = (buffer + decoder.decode(bytes, {stream: true})).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const raw = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (raw === '[DONE]') {complete = true; continue}
        if (!raw) continue;
        const event = JSON.parse(raw);
        if (event.error) throw new Error('DeepSeek stream failed');
        if (event.usage) usage = event.usage;
        const delta = event.choices?.[0]?.delta || {};
        if (delta.content) {text += delta.content; onText(delta.content)}
        for (const call of delta.tool_calls || []) {
          const target = calls[call.index] ||= {id: '', function: {name: '', arguments: ''}};
          if (call.id) target.id = call.id;
          if (call.function?.name) target.function.name += call.function.name;
          if (call.function?.arguments) target.function.arguments += call.function.arguments;
        }
      }
      if (buffer.length > 2000000 || text.length > 200000) throw new Error('DeepSeek stream too large');
    }
    if (!complete) throw new Error('DeepSeek stream interrupted');
    payload = {usage, choices: [{message: {content: text, tool_calls: calls}}]};
  } else payload = await response.json();
  reportUsage(payload.usage, response);
  const output = payload.choices?.[0]?.message?.content;
  const toolCalls = (payload.choices?.[0]?.message?.tool_calls || []).map(call => ({
    id: call.id, name: call.function.name.replace(/__/g, '.'), input: JSON.parse(call.function.arguments)
  }));
  if (!toolCalls.length && (typeof output !== 'string' || !output.trim())) throw new Error('DeepSeek returned no text output');
  return {text: output || '', ...(toolCalls.length ? {toolCalls} : {}), provider: 'deepseek', model: request.model, usage: payload.usage || undefined};
}

module.exports = {DEFAULT_BASE_URL, normalizeBaseUrl, generate};
