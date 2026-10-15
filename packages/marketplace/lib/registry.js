'use strict';

const crypto = require('crypto');

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/firekylin/plugins/main/registry.json';
const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com', 'plugins.firekylin.com']);

function trustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error('UNTRUSTED_MARKETPLACE_URL');
  if (url.hostname === 'raw.githubusercontent.com' && !url.pathname.startsWith('/firekylin/plugins/')) {
    throw new Error('UNTRUSTED_MARKETPLACE_URL');
  }
  return url;
}

async function download(url, {maxBytes, fetcher = fetch}) {
  let current = trustedUrl(url);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetcher(current, {redirect: 'manual', headers: {'user-agent': 'Firekylin-Marketplace/1'}});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      current = trustedUrl(new URL(response.headers.get('location'), current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`MARKETPLACE_DOWNLOAD_${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared && declared > maxBytes) throw new Error('MARKETPLACE_DOWNLOAD_TOO_LARGE');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('MARKETPLACE_DOWNLOAD_TOO_LARGE');
    return buffer;
  }
  throw new Error('MARKETPLACE_TOO_MANY_REDIRECTS');
}

function verify(buffer, integrity) {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(String(integrity || ''));
  if (!match) throw new Error('MARKETPLACE_INTEGRITY_REQUIRED');
  const actual = crypto.createHash('sha512').update(buffer).digest();
  const expected = Buffer.from(match[1], 'base64');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('MARKETPLACE_INTEGRITY_MISMATCH');
  }
}

class Registry {
  constructor({url = DEFAULT_REGISTRY, fetcher} = {}) {
    this.url = url;
    this.fetcher = fetcher;
  }

  async list() {
    const buffer = await download(this.url, {maxBytes: 1024 * 1024, fetcher: this.fetcher});
    let registry;
    try { registry = JSON.parse(buffer.toString('utf8')) } catch { throw new Error('INVALID_MARKETPLACE_REGISTRY') }
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.packages)) {
      throw new Error('INVALID_MARKETPLACE_REGISTRY');
    }
    return registry.packages.filter(item => item && ['plugin', 'theme'].includes(item.type) &&
      typeof item.name === 'string' && typeof item.version === 'string');
  }

  async themeArchive(item) {
    if (item.type !== 'theme' || !item.download) throw new Error('INVALID_THEME_PACKAGE');
    const archive = await download(item.download, {maxBytes: 20 * 1024 * 1024, fetcher: this.fetcher});
    verify(archive, item.integrity);
    return archive;
  }
}

module.exports = {Registry, DEFAULT_REGISTRY, trustedUrl, download, verify};
