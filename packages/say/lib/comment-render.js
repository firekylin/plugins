'use strict';
const {escapeHtml: esc} = require('./render');

function renderComments(id, result, config) {
  const captcha = config.captcha;
  const key = captcha?.siteKey || '';
  const provider = captcha?.provider || 'none';
  const script = provider === 'turnstile'
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : provider === 'recaptcha-v3'
      ? `<script src="https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}" async defer></script>` : '';
  return `<section aria-labelledby="comments-title"><h2 id="comments-title">评论 (${result.total})</h2>
    ${result.items.map(item => `<article class="say-item"><b>${esc(item.nick)}</b> <time>${esc(item.createdAt)}</time><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(item.comment)}</p></article>`).join('')}
    <nav>${result.page > 1 ? `<a href="?page=${result.page - 1}#comments-title">上一页评论</a>` : ''}
    ${result.page * result.pageSize < result.total ? `<a href="?page=${result.page + 1}#comments-title">下一页评论</a>` : ''}</nav>
    <p>评论审核通过后显示。${config.forceLogin ? '本站要求登录后评论。' : ''}<a href="/admin/login">登录博客</a></p>
    <form id="say-comment-form" data-endpoint="/api/plugins/say/comments/${Number(id)}" data-provider="${esc(provider)}" data-key="${esc(key)}">
    <p><label>昵称 <input name="nick" maxlength="80" autocomplete="nickname"></label></p>
    <p><label>邮箱（不会公开）<input name="mail" type="email" maxlength="255" autocomplete="email"></label></p>
    <p><label>网站 <input name="link" type="url" maxlength="512" autocomplete="url"></label></p>
    <p><label>评论 <textarea name="comment" required maxlength="5000" rows="5" style="display:block;width:100%;box-sizing:border-box"></textarea></label></p>
    ${provider === 'turnstile' ? `<div class="cf-turnstile" data-sitekey="${esc(key)}"></div>` : ''}
    <button type="submit">提交评论</button><p id="say-comment-result" role="status" aria-live="polite"></p></form>${script}
    <script>
    (() => {
      const form = document.getElementById('say-comment-form');
      const result = document.getElementById('say-comment-result');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button');
        if (button.disabled) return;
        button.disabled = true;
        result.textContent = '提交中…';
        try {
          const fields = new FormData(form);
          const body = Object.fromEntries(['nick', 'mail', 'link', 'comment'].map(key => [key, fields.get(key)]));
          if (form.dataset.provider === 'turnstile') body.captcha = fields.get('cf-turnstile-response') || '';
          if (form.dataset.provider === 'recaptcha-v3') {
            if (!window.grecaptcha) throw new Error('验证码尚未加载，请稍后重试。');
            await new Promise(resolve => window.grecaptcha.ready(resolve));
            body.captcha = await window.grecaptcha.execute(form.dataset.key, {action: 'social'});
          }
          const response = await fetch(form.dataset.endpoint, {method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
          const payload = await response.json();
          result.textContent = payload.success ? payload.data.message : payload.message;
          if (payload.success) form.elements.comment.value = '';
        } catch {
          result.textContent = '提交未确认，请刷新页面核对，勿立即重发；验证码未加载时请稍后再试。';
        } finally {
          button.disabled = false;
          if (window.turnstile) window.turnstile.reset();
        }
      });
    })();
    </script></section>`;
}
module.exports = {renderComments};

function renderWalineComments(item, {options, public: publicConfig}) {
  if (typeof item.pathname !== 'string' || !item.pathname.trim()) {
    throw new TypeError('A stored Say pathname is required for native comments');
  }
  // Waline 3.16 decodes path once before sending it. Protect query-value escapes
  // so core receives the stored pathname, not an ID or a partially decoded value.
  const path = `/says/${item.id}?pathname=${encodeURIComponent(item.pathname)}&type=3`;
  const settings = options.comment || {};
  const config = {
    path: encodeURI(path),
    login: publicConfig.forceLogin ? 'force' : 'enable',
    lang: settings.locale && settings.locale !== 'auto' ? settings.locale : 'zh-CN',
    pageSize: Number(settings.pageSize) || 10,
    turnstileKey: publicConfig.captcha?.provider === 'turnstile' ? publicConfig.captcha.siteKey : '',
    recaptchaV3Key: publicConfig.captcha?.provider === 'recaptcha-v3' ? publicConfig.captcha.siteKey : ''
  };
  for (const key of ['meta', 'requiredMeta', 'wordLimit', 'emoji', 'reaction', 'imageUploader',
    'highlighter', 'texRenderer', 'search', 'noCopyright', 'noRss', 'dark', 'commentSorting']) {
    if (settings[key] !== undefined) config[key] = settings[key];
  }
  return `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@waline/client@3.16.0/dist/waline.css">
  <section class="say-item"><div id="say-comments" data-config="${esc(JSON.stringify(config))}">评论加载中…</div></section>
  <script type="module">
    const container = document.getElementById('say-comments');
    try {
      const config = JSON.parse(container.dataset.config);
      config.serverURL = new URL('/api/comment', window.location.origin).href;
      const [client, response] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/@waline/client@3.16.0/dist/waline.js'),
        fetch(config.serverURL + '/api/token', {credentials: 'same-origin'})
      ]);
      const result = await response.json();
      if (!response.ok || result.errno !== 0) throw new Error('session');
      if (result.data?.objectId) localStorage.setItem('WALINE_USER', JSON.stringify({...result.data, remember: true}));
      else localStorage.removeItem('WALINE_USER');
      container.textContent = '';
      client.init({...config, el: container});
    } catch {
      container.textContent = '评论暂时无法加载，请刷新页面后重试。';
    }
  </script>`;
}

module.exports.renderWalineComments = renderWalineComments;
