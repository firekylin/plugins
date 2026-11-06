'use strict';
const path = require('node:path');
let core;
if (process.env.FIREKYLIN_CORE_PATH) core = require(path.join(process.env.FIREKYLIN_CORE_PATH, 'src/ai/stream'));
module.exports = core ? generate => async options => {
  const result = await generate({...options, streamResponse: core.streamResponse});
  return result?.stream ? core.consumeStream(result, options) : result;
} : null;
