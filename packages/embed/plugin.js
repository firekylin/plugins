'use strict';

function resolveEmbed(value, {youkuClientId} = {}) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  let id;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    id = host === 'youtu.be' ? path.slice(1) : path === '/watch' ? url.searchParams.get('v') : (path.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/) || [])[1];
    if (!/^[\w-]{11}$/.test(id || '')) return null;
    return {src: `https://www.youtube-nocookie.com/embed/${id}`, title: 'YouTube video'};
  }
  if (['open.spotify.com', 'play.spotify.com'].includes(host) && (id = path.match(/^\/(?:intl-[a-z]+\/)?(track|album|artist|playlist|episode|show)\/([A-Za-z0-9]{22})\/?$/))) {
    return {src: `https://open.spotify.com/embed/${id[1]}/${id[2]}`, title: 'Spotify audio', height: 352};
  }
  if (['soundcloud.com', 'www.soundcloud.com'].includes(host) && /^\/[\w-]+\/(?:sets\/)?[\w-]+\/?$/.test(path)) {
    return {src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com${path}`)}&auto_play=false`, title: 'SoundCloud audio', height: 300};
  }
  if (['tiktok.com', 'www.tiktok.com'].includes(host) && (id = path.match(/^\/@[\w.-]+\/video\/(\d+)\/?$/))) {
    return {src: `https://www.tiktok.com/player/v1/${id[1]}?autoplay=0`, title: 'TikTok video', height: 600};
  }
  if (['v.youku.com', 'm.youku.com'].includes(host)) {
    id = (path.match(/^\/v_show\/id_([A-Za-z0-9=]+)\.html$/) || [])[1];
    if (path === '/video') id = url.searchParams.get('vid');
    if (!/^X[A-Za-z0-9]+={0,2}$/.test(id || '')) return null;
    const client = typeof youkuClientId === 'string' && /^[A-Za-z0-9_-]+$/.test(youkuClientId) ? `&client_id=${encodeURIComponent(youkuClientId)}` : '';
    return {src: `https://player.youku.com/embed/${id}?autoplay=false${client}`, title: 'Youku video'};
  }
  if (['v.qq.com', 'm.v.qq.com'].includes(host)) {
    id = (path.match(/^\/x\/(?:page\/|cover\/[A-Za-z0-9]+\/)([A-Za-z0-9]{11})\.html$/) || [])[1];
    if (['/txp/iframe/player.html', '/iframe/player.html', '/play.html', '/x/cover'].includes(path)) id = url.searchParams.get('vid');
    if (!/^[A-Za-z0-9]{11}$/.test(id || '')) return null;
    return {src: `https://v.qq.com/txp/iframe/player.html?vid=${id}&autoplay=false`, title: 'Tencent video'};
  }
  if (['music.163.com', 'www.music.163.com', 'y.music.163.com'].includes(host)) {
    const resource = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), 'https://music.163.com') : url;
    const kind = (resource.pathname.match(/^\/(?:m\/)?(song|album|playlist)\/?$/) || [])[1];
    const type = {song: 2, album: 1, playlist: 0}[kind];
    id = resource.searchParams.get('id');
    if (type === undefined || !/^[1-9]\d*$/.test(id || '')) return null;
    const height = kind === 'song' ? 86 : 450;
    return {src: `https://music.163.com/outchain/player?type=${type}&id=${id}&auto=0&height=${height - 20}`, title: 'NetEase Cloud Music', height};
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

function embedPlugin(md, options = {}) {
  const {providers} = options;
  md.core.ruler.after('inline', 'firekylin_embed', state => {
    for (let i = 0; i < state.tokens.length - 2; i++) {
      const [open, inline, close] = state.tokens.slice(i, i + 3);
      if (open.type !== 'paragraph_open' || open.hidden || inline.type !== 'inline' || close.type !== 'paragraph_close') continue;
      const raw = inline.content.trim();
      if (!/^https?:\/\/\S+$/.test(raw)) continue;
      const embed = resolveEmbed(raw, options);
      if (!embed || (Array.isArray(providers) && !providers.includes(new URL(embed.src).hostname))) continue;
      open.type = 'html_block';
      open.tag = '';
      open.nesting = 0;
      const escape = md.utils.escapeHtml;
      open.content = `<div class="firekylin-embed"><iframe src="${escape(embed.src)}" title="${escape(embed.title)}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen style="display:block;width:100%;${embed.height ? `height:${embed.height}px;` : embed.code ? 'height:400px;' : 'aspect-ratio:16/9;'}border:0"></iframe></div>\n`;
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
