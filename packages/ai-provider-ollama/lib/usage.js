'use strict';
const {createUsageAdapter} = require('firekylin-ai-provider-utils');
module.exports = createUsageAdapter({inputTokens: 'prompt_eval_count', outputTokens: 'eval_count'});
