'use strict';

const {listUrl, detailUrl, tagUrl, pageUrl} = require('./urls');

function escapeHtml(value) {
  return String(value === null || typeof value === 'undefined' ? '' : value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;'
  })[character]);
}

function media(item, options = {}) {
  if (['image', 'textpic'].includes(item.kind)) {
    return `<div class="say-images">${item.images.map(url => `<img src="${escapeHtml(url)}" loading="lazy" alt="">`).join('')}</div>`;
  }
  if (item.kind === 'voice') return `<audio controls preload="none" src="${escapeHtml(item.mediaUrl)}"></audio>`;
  if (item.kind === 'location') {
    const label = escapeHtml(item.label || `${item.latitude}, ${item.longitude}`);
    const map = options.amapKey ? new URL('https://restapi.amap.com/v3/staticmap') : null;
    if (map) {
      map.searchParams.set('key', options.amapKey);
      map.searchParams.set('location', `${item.longitude},${item.latitude}`);
      map.searchParams.set('zoom', '15');
      map.searchParams.set('size', '640*240');
      map.searchParams.set('markers', `mid,,A:${item.longitude},${item.latitude}`);
    }
    return `<p class="say-meta">📍 ${label}</p>${map ? `<img class="say-map" src="${escapeHtml(map)}" loading="lazy" alt="${label}">` : ''}`;
  }
  if (item.kind === 'link' || item.kind === 'music') {
    const label = item.title || item.url;
    return `<div class="say-card">${item.cover ? `<img src="${escapeHtml(item.cover)}" loading="lazy" alt="">` : ''}<p>` +
      `<a href="${escapeHtml(item.url)}" rel="nofollow noreferrer">${escapeHtml(label)}</a>` +
      `${item.artist ? ` · ${escapeHtml(item.artist)}` : ''}` +
      `${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}</p></div>`;
  }
  return '';
}

// Keep the template contract explicit: never spread settings, identities or model rows.
function publicItem(item) {
  const data = {};
  for (const key of ['id', 'pathname', 'allowComments', 'commentCount', 'kind', 'status', 'text',
    'source', 'mediaUrl', 'latitude', 'longitude', 'label', 'url', 'title', 'description',
    'artist', 'cover', 'createdAt', 'updatedAt']) {
    if (item[key] !== undefined) data[key] = item[key];
  }
  data.images = [...(item.images || [])];
  data.tags = [...(item.tags || [])];
  data.detailUrl = detailUrl(item.id);
  data.tagLinks = data.tags.map(name => ({name, url: tagUrl(name)}));
  return data;
}

function renderItems(items, options = {}) {
  return items.map(item => `<article class="say-item">
    <div class="say-text">${escapeHtml(item.text).replaceAll('\n', '<br>')}</div>
    ${media(item, options)}
    <footer>${item.tagLinks.map(tag => `<a href="${escapeHtml(tag.url)}">#${escapeHtml(tag.name)}</a>`).join(' ')}
      <a href="${escapeHtml(item.detailUrl)}">详情 / 评论 ${Number(item.commentCount) || 0}</a><time>${escapeHtml(item.createdAt)}</time></footer>
  </article>`).join('');
}

function createSayViewModel(result, {title = '碎语', tag = '', section = '', composer = '',
  navigation = null, view = navigation ? 'detail' : tag ? 'tag' : 'list', listPath = listUrl} = {}) {
  const items = result.items.map(publicItem);
  const neighbor = id => id ? {id: Number(id), url: detailUrl(id)} : null;
  return {
    view,
    title: tag ? `#${tag} - ${title}` : title,
    heading: tag ? `#${tag}` : title,
    tag,
    items,
    item: view === 'detail' ? items[0] || null : null,
    pagination: {
      page: result.page, pageSize: result.pageSize, total: result.total,
      totalPages: Math.ceil(result.total / result.pageSize),
      previousUrl: result.page > 1 ? pageUrl(result.page - 1, tag, listPath) : null,
      nextUrl: result.page * result.pageSize < result.total ? pageUrl(result.page + 1, tag, listPath) : null
    },
    navigation: {previous: neighbor(navigation?.previous), next: neighbor(navigation?.next)},
    urls: {list: listUrl, tag: tag ? tagUrl(tag) : null,
      current: view === 'detail' ? items[0]?.detailUrl || null : pageUrl(result.page, tag, listPath)},
    // Reuse escaped components, never raw credentials. Custom themes receive location
    // data/text, not the configured map service key embedded by the legacy page.
    html: {items: renderItems(items), composer, comments: section}
  };
}

function renderSayPage(result, {amapKey = '', viewModel, ...options} = {}) {
  const page = viewModel || createSayViewModel(result, options);
  const items = amapKey ? renderItems(page.items, {amapKey}) : page.html.items;
  const {previousUrl, nextUrl} = page.pagination;
  const previous = previousUrl ? `<a href="${escapeHtml(previousUrl)}">上一页</a>` : '';
  const next = nextUrl ? `<a href="${escapeHtml(nextUrl)}">下一页</a>` : '';
  const navigation = page.navigation;
  const detailNavigation = navigation.previous || navigation.next
    ? `<nav aria-label="相邻微博">${navigation.previous ? `<a href="${escapeHtml(navigation.previous.url)}" rel="prev">← 上一条</a>` : '<span></span>'}
      ${navigation.next ? `<a href="${escapeHtml(navigation.next.url)}" rel="next">下一条 →</a>` : '<span></span>'}</nav>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(page.title)}</title><style>
  body{margin:0;background:#f5f5f5;color:#222;font:16px/1.7 system-ui,sans-serif}.say-wrap{max-width:720px;margin:0 auto;padding:32px 20px}
  h1{font-size:28px}.say-item{background:#fff;border-radius:10px;padding:20px 24px;margin:16px 0;box-shadow:0 1px 3px #0001}
  .say-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:12px}.say-images img{width:100%;border-radius:6px}
  .say-map{display:block;width:100%;max-height:240px;object-fit:cover;border-radius:6px}.say-card{display:flex;gap:12px;align-items:center;margin-top:12px}.say-card img{width:72px;height:72px;object-fit:cover;border-radius:6px}.say-card p{margin:0}.say-card small{display:block;color:#888}
  footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;color:#888;font-size:13px}footer time{margin-left:auto}a{color:#1677ff;text-decoration:none}
  nav{display:flex;justify-content:space-between;margin-top:24px}.say-empty{color:#888}</style></head><body><main class="say-wrap">
  <h1>${escapeHtml(page.heading)}</h1>${page.html.composer}${items || '<p class="say-empty">暂无碎语</p>'}${page.view === 'detail' ? detailNavigation : `<nav>${previous}<span></span>${next}</nav>`}
  ${page.html.comments}</main></body></html>`;
}

module.exports = {escapeHtml, renderSayPage, createSayViewModel};
