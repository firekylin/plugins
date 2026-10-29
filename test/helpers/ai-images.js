'use strict';
const path = require('node:path');
// Provider integration tests can use an available core without bundling its implementation.
try {
  module.exports = require(process.env.FIREKYLIN_CORE_PATH
    ? path.join(process.env.FIREKYLIN_CORE_PATH, 'src/service/ai-images')
    : 'firekylin/src/service/ai-images');
} catch (error) {
  if (process.env.FIREKYLIN_CORE_PATH || error.code !== 'MODULE_NOT_FOUND') throw error;
  module.exports = null;
}
