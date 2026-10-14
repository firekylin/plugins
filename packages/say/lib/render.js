'use strict';

function escapeHtml(value) {
  return String(value === null || typeof value === 'undefined' ? '' : value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;'
  })[character]);
}

function media(item) {
  if (['image', 'textpic'].includes(item.kind)) {
    return `<div class="say-images">${item.images.map(url => `<img src="${escapeHtml(url)}" loading="lazy" alt="">`).join('')}</div>`;
  }
  if (item.kind === 'voice') return `<audio controls preload="none" src="${escapeHtml(item.mediaUrl)}"></audio>`;
  if (item.kind === 'location') {
    return `<p class="say-meta">📍 ${escapeHtml(item.label || `${item.latitude}, ${item.longitude}`)}</p>`;
  }
  if (item.kind === 'link' || item.kind === 'music') {
    const label = item.title || item.url;
    return `<p><a href="${escapeHtml(item.url)}" rel="nofollow noreferrer">${escapeHtml(label)}</a>` +
      `${item.artist ? ` · ${escapeHtml(item.artist)}` : ''}</p>`;
  }
  return '';
}

function renderSayPage(result, {title = '碎语', tag = ''} = {}) {
  const items = result.items.map(item => `<article class="say-item">
    <div class="say-text">${escapeHtml(item.text).replaceAll('\n', '<br>')}</div>
    ${media(item)}
    <footer>${item.tags.map(value => `<a href="?tag=${encodeURIComponent(value)}">#${escapeHtml(value)}</a>`).join(' ')}
      <time>${escapeHtml(item.createdAt)}</time></footer>
  </article>`).join('');
  const previous = result.page > 1 ? `<a href="?page=${result.page - 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}">上一页</a>` : '';
  const next = result.page * result.pageSize < result.total
    ? `<a href="?page=${result.page + 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}">下一页</a>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(tag ? `#${tag} - ${title}` : title)}</title><style>
  body{margin:0;background:#f5f5f5;color:#222;font:16px/1.7 system-ui,sans-serif}.say-wrap{max-width:720px;margin:0 auto;padding:32px 20px}
  h1{font-size:28px}.say-item{background:#fff;border-radius:10px;padding:20px 24px;margin:16px 0;box-shadow:0 1px 3px #0001}
  .say-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:12px}.say-images img{width:100%;border-radius:6px}
  footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;color:#888;font-size:13px}footer time{margin-left:auto}a{color:#1677ff;text-decoration:none}
  nav{display:flex;justify-content:space-between;margin-top:24px}.say-empty{color:#888}</style></head><body><main class="say-wrap">
  <h1>${escapeHtml(tag ? `#${tag}` : title)}</h1>${items || '<p class="say-empty">暂无碎语</p>'}<nav>${previous}<span></span>${next}</nav>
  </main></body></html>`;
}

module.exports = {escapeHtml, renderSayPage};
