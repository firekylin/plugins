'use strict';

const adapters = {
  valine: require('./valine'),
  waline: require('./waline'),
  twikoo: require('./twikoo'),
  artalk: require('./artalk'),
  gitalk: require('./gitalk'),
  giscus: require('./giscus'),
  commento: require('./commento')
};

function parseInput(input) {
  if (typeof input !== 'string') return input;
  const trimmed = input.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('EMPTY_SOURCE');
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // Accept newline-delimited JSON exports used by some self-hosted tools.
    try {
      return trimmed.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    } catch (lineError) {
      throw new Error('INVALID_JSON', {cause: error});
    }
  }
}

function parse(platform, source) {
  const adapter = adapters[String(platform || '').toLowerCase()];
  if (!adapter) throw new Error('UNSUPPORTED_PLATFORM');
  const comments = adapter(parseInput(source)).filter(item => item.content && item.url);
  const ids = new Set();
  return comments.map((item, index) => {
    const sourceId = item.sourceId || `${platform}:${index}`;
    const uniqueId = ids.has(sourceId) ? `${sourceId}:${index}` : sourceId;
    ids.add(uniqueId);
    return {...item, sourceId: uniqueId};
  });
}

module.exports = {adapters, parse, parseInput, platforms: Object.keys(adapters)};
