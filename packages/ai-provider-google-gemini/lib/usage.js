'use strict';
const {createUsageAdapter, sumTokens} = require('firekylin-ai-provider-utils');
module.exports = createUsageAdapter({
  inputTokens: 'promptTokenCount',
  // Gemini candidate tokens exclude thoughts; totalTokenCount already includes them.
  outputTokens: usage => sumTokens(usage.candidatesTokenCount, usage.thoughtsTokenCount ?? 0),
  totalTokens: 'totalTokenCount', cacheReadTokens: 'cachedContentTokenCount', reasoningTokens: 'thoughtsTokenCount'
});
