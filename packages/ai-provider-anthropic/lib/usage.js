'use strict';
const {createUsageAdapter, sumTokens} = require('firekylin-ai-provider-utils');
module.exports = createUsageAdapter({
  // Native input_tokens excludes cache creation and reads; include them exactly once.
  inputTokens: usage => sumTokens(usage.input_tokens, usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0),
  outputTokens: 'output_tokens', totalTokens: 'total_tokens',
  cacheReadTokens: 'cache_read_input_tokens', cacheWriteTokens: 'cache_creation_input_tokens'
});
