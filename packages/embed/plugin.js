'use strict';

function resolveEmbed(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  let id;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    id = host === 'youtu.be' ? path.slice(1) : path === '/watch' ? url.searchParams.get('v') : (path.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/) || [])[1];
    if (!/^[\w-]{11}$/.test(id || '')) return null;
    return {src: `https://www.youtube-nocookie.com/embed/${id}`, title: 'YouTube video'};
  }
  if (['vimeo.com', 'www.vimeo.com'].includes(host) && (id = path.match(/^\/(\d+)\/?$/))) {
    return {src: `https://player.vimeo.com/video/${id[1]}`, title: 'Vimeo video'};
  }
  if (['bilibili.com', 'www.bilibili.com'].includes(host) && (id = path.match(/^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/))) {
    const key = id[1].startsWith('BV') ? `bvid=${id[1]}` : `aid=${id[1].slice(2)}`;
    const page = url.searchParams.get('p');
    return {src: `https://player.bilibili.com/player.html?${key}&autoplay=0${/^[1-9]\d*$/.test(page || '') ? `&page=${page}` : ''}`, title: 'Bilibili video'};
  }
  if (host === 'jsfiddle.net' && (id = path.match(/^\/([\w-]+\/[\w-]+|[\w-]+)(?:\/(\d+))?\/?$/))) {
    return {src: `https://jsfiddle.net/${id[1]}/${id[2] ? `${id[2]}/` : ''}embedded/`, title: 'JSFiddle demo', code: true};
  }
  if (host === 'gist.github.com' && (id = path.match(/^\/([\w-]+)\/([a-f\d]+)\/?$/i))) {
    return {src: `https://gist.github.com/${id[1]}/${id[2]}.pibb`, title: 'GitHub Gist', code: true};
  }
  return null;
}

function embedPlugin(md, {providers} = {}) {
  md.core.ruler.after('inline', 'firekylin_embed', state => {
    for (let i = 0; i < state.tokens.length - 2; i++) {
      const [open, inline, close] = state.tokens.slice(i, i + 3);
      if (open.type !== 'paragraph_open' || open.hidden || inline.type !== 'inline' || close.type !== 'paragraph_close') continue;
      const raw = inline.content.trim();
      if (!/^https?:\/\/\S+$/.test(raw)) continue;
      const embed = resolveEmbed(raw);
      if (!embed || (Array.isArray(providers) && !providers.includes(new URL(embed.src).hostname))) continue;
      open.type = 'html_block';
      open.tag = '';
      open.nesting = 0;
      const escape = md.utils.escapeHtml;
      open.content = `<div class="firekylin-embed"><iframe src="${escape(embed.src)}" title="${escape(embed.title)}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" allowfullscreen style="display:block;width:100%;${embed.code ? 'height:400px;' : 'aspect-ratio:16/9;'}border:0"></iframe><a href="${escape(raw)}" rel="noopener noreferrer">${escape(raw)}</a></div>\n`;
      state.tokens.splice(i + 1, 2);
    }
  });
}

module.exports = {
  register(ctx) {
    ctx.events.on('markdown.configure', md => {
      md.use(embedPlugin, ctx.config || {});
      return md;
    });
  },
  embedPlugin,
  resolveEmbed
};
