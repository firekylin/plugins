'use strict';
const FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
function token(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null }
function sumTokens(...values) {
  const counts = values.map(token);
  return counts.every(value => value !== null) ? token(counts.reduce((a, b) => a + b, 0)) : null;
}
function read(value, selector) {
  if (typeof selector === 'function') return selector(value);
  if (Array.isArray(selector)) {
    for (const path of selector) {
      const count = token(read(value, path));
      if (count !== null) return count;
    }
    return null;
  }
  return typeof selector === 'string' ? selector.split('.').reduce((item, key) => item?.[key], value) : null;
}
function createUsageAdapter(fields, {requestIdHeaders = ['x-request-id', 'request-id', 'cf-ray']} = {}) {
  // Snapshot the declaration; shared adapters cannot be mutated by another provider.
  const mapping = Object.fromEntries(FIELDS.map(key => [key, Array.isArray(fields[key]) ? [...fields[key]] : fields[key]]));
  const headers = [...requestIdHeaders];
  function metadata(usage, response = {}) {
    const usageDetails = Object.fromEntries(FIELDS.map(key => [key, token(read(usage || {}, mapping[key]))]));
    if (usageDetails.totalTokens === null) usageDetails.totalTokens = sumTokens(usageDetails.inputTokens, usageDetails.outputTokens);
    const providerRequestId = headers.map(name => response.headers?.get?.(name)).find(Boolean);
    return {usageDetails, ...(providerRequestId ? {providerRequestId} : {})};
  }
  function failure(message, response, usage) {
    const error = new Error(message);
    const result = metadata(usage, response);
    if (result.providerRequestId) error.providerRequestId = result.providerRequestId;
    if (usage !== undefined && usage !== null) error.usageDetails = result.usageDetails;
    return error;
  }
  return Object.freeze({metadata, failure});
}
// Protocol schemas, not vendor IDs. Vendors only override fields that differ from their protocol.
const CHAT_COMPLETION_FIELDS = Object.freeze({
  inputTokens: 'prompt_tokens', outputTokens: 'completion_tokens', totalTokens: 'total_tokens',
  cacheReadTokens: 'prompt_tokens_details.cached_tokens', reasoningTokens: 'completion_tokens_details.reasoning_tokens'
});
const RESPONSE_FIELDS = Object.freeze({
  inputTokens: 'input_tokens', outputTokens: 'output_tokens', totalTokens: 'total_tokens',
  cacheReadTokens: 'input_tokens_details.cached_tokens', reasoningTokens: 'output_tokens_details.reasoning_tokens'
});
const chatUsage = createUsageAdapter(CHAT_COMPLETION_FIELDS);
const responsesUsage = createUsageAdapter(RESPONSE_FIELDS);
module.exports = {createUsageAdapter, sumTokens, CHAT_COMPLETION_FIELDS, RESPONSE_FIELDS, chatUsage, responsesUsage};
