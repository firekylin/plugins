'use strict';
// Packaged locally so each provider remains independently installable.
function token(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null }
function sum(...values) { return values.every(value => value !== null) ? token(values.reduce((a, b) => a + b, 0)) : null }
function metadata(usage, response, kind = 'compatible') {
  const u = usage || {};
  let input = token(u.input_tokens ?? u.prompt_tokens);
  let output = token(u.output_tokens ?? u.completion_tokens);
  let total = token(u.total_tokens);
  let cacheRead = token(u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens);
  let cacheWrite = token(u.cache_creation_input_tokens);
  let reasoning = token(u.output_tokens_details?.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens);
  if (kind === 'anthropic') {
    // Anthropic input_tokens excludes cache creation and cache reads.
    input = sum(input, token(u.cache_creation_input_tokens ?? 0), token(u.cache_read_input_tokens ?? 0));
  }
  if (kind === 'gemini') {
    input = token(u.promptTokenCount);
    reasoning = token(u.thoughtsTokenCount);
    // Candidate tokens exclude thoughts. Keep output unknown when that count is absent.
    output = sum(token(u.candidatesTokenCount), token(u.thoughtsTokenCount ?? 0));
    total = token(u.totalTokenCount);
    cacheRead = token(u.cachedContentTokenCount);
    cacheWrite = null;
  }
  if (total === null) total = sum(input, output);
  const requestId = response.headers?.get?.('x-request-id') || response.headers?.get?.('request-id') || response.headers?.get?.('cf-ray');
  return {usageDetails: {inputTokens: input, outputTokens: output, totalTokens: total,
    cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: reasoning},
  ...(requestId ? {providerRequestId: requestId} : {})};
}
function failure(message, response, usage, kind) {
  const error = new Error(message);
  const requestId = response.headers?.get?.('x-request-id') || response.headers?.get?.('request-id') || response.headers?.get?.('cf-ray');
  if (requestId) error.providerRequestId = requestId;
  if (usage) Object.assign(error, metadata(usage, response, kind));
  return error;
}
module.exports = {metadata, failure};
