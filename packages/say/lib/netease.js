'use strict';

const NETEASE_HOSTS = new Set(['music.163.com', 'y.music.163.com']);

function decodeEntities(value) {
  return String(value || '').replace(/&(?:amp|quot|#39|lt|gt);/g, entity => ({
    '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>'
  })[entity]);
}

function meta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return decodeEntities(match[1]).trim();
  }
  return '';
}

function normalizeNeteaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()) } catch { return null }
  if (!NETEASE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const hash = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : null;
  const id = url.searchParams.get('id') || hash?.searchParams.get('id') || /^\/(?:song|m\/song)\/(\d+)/.exec(url.pathname)?.[1];
  if (!/^\d{1,20}$/.test(String(id || ''))) return null;
  return `https://music.163.com/song?id=${id}`;
}

async function resolveNeteaseMusic(input, fetchImpl = global.fetch) {
  const canonical = normalizeNeteaseUrl(input && input.url);
  if (!canonical || typeof fetchImpl !== 'function') return input;
  const response = await fetchImpl(canonical, {
    headers: {'User-Agent': 'Mozilla/5.0 Firekylin Say Plugin'},
    redirect: 'error', signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw Object.assign(new Error('Unable to read NetEase Music metadata'), {status: 502});
  const html = await response.text();
  const title = meta(html, 'og:title');
  const artist = meta(html, 'music:musician') || meta(html, 'og:music:artist');
  const cover = meta(html, 'og:image');
  return {...input, url: canonical, title: input.title || title, artist: input.artist || artist,
    cover: input.cover || cover};
}

module.exports = {NETEASE_HOSTS, meta, normalizeNeteaseUrl, resolveNeteaseMusic};
