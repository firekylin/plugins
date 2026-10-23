'use strict';
const {createUsageAdapter, CHAT_COMPLETION_FIELDS} = require('firekylin-ai-provider-utils');
module.exports = createUsageAdapter({...CHAT_COMPLETION_FIELDS,
  cacheReadTokens: ['prompt_cache_hit_tokens', CHAT_COMPLETION_FIELDS.cacheReadTokens]
});
