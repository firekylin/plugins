'use strict';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderFriendLinksPage(links, {title = '友情链接'} = {}) {
  const groups = new Map();
  for (const link of links) {
    if (!groups.has(link.category)) groups.set(link.category, []);
    groups.get(link.category).push(link);
  }
  const content = [...groups.entries()].map(([category, items]) => `<section><h2>${escapeHtml(category)}</h2><div class="links">${items.map(link =>
    `<a class="link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">` +
    (link.avatar ? `<img src="${escapeHtml(link.avatar)}" alt="" loading="lazy">` : '') +
    `<span><strong>${escapeHtml(link.name)}</strong>${link.description ? `<small>${escapeHtml(link.description)}</small>` : ''}</span></a>`
  ).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
body{max-width:960px;margin:0 auto;padding:32px 20px;font:16px/1.6 system-ui,sans-serif;color:#222}h1{margin-bottom:32px}h2{font-size:20px}.links{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.link{display:flex;align-items:center;gap:12px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;color:inherit;text-decoration:none}.link:hover{border-color:#9ca3af}.link img{width:44px;height:44px;border-radius:50%;object-fit:cover}.link span{min-width:0}.link strong,.link small{display:block}.link small{color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.empty{color:#6b7280}</style></head><body><h1>${escapeHtml(title)}</h1>${content || '<p class="empty">暂无友情链接。</p>'}</body></html>`;
}

module.exports = {escapeHtml, renderFriendLinksPage};
