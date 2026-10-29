'use strict';
// Exercise the actual core contract rather than maintaining a second implementation in tests.
const path = require('node:path');
module.exports = require(process.env.FIREKYLIN_CORE_PATH
  ? path.join(process.env.FIREKYLIN_CORE_PATH, 'src/service/ai-images')
  : 'firekylin/src/service/ai-images');
