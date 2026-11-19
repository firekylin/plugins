'use strict';
const {escapeHtml: esc} = require('./render');

class FrontendPublish {
  constructor({say, getModel, getService}) { Object.assign(this, {say, getModel, getService}) }

  async identity(request) {
    const options = await this.getModel('options').getOptions(true);
    request.state.jwtSecret ||= options.jwt_secret || options.comment_jwt_secret;
    const auth = this.getService('admin-auth');
    const session = auth.currentUser(request);
    if (!session) return {loggedIn: false};
    const user = await this.getModel('user').where({id: session.id}).find();
    if (!user?.id || Number(user.status) !== 1) return {loggedIn: false};
    const canPublish = Number(session.type) === 1 && Number(user.type) === 1;
    return {loggedIn: true, canPublish, id: Number(user.id), csrf: canPublish ? auth.csrfToken(request) : ''};
  }

  async submit(request, body = {}) {
    if (request.get('origin') !== `${request.protocol}://${request.host}` || !request.is('application/json')) {
      return request.throw(403, '请从本站发布框提交。');
    }
    const identity = await this.identity(request);
    if (!identity.canPublish) return request.throw(403, '当前账号没有发布权限，请使用管理员账号登录。');
    if (!identity.csrf || request.get('X-CSRF-Token') !== identity.csrf) return request.throw(403, '登录状态已变化，请刷新页面。');
    if (!(await this.say.settings()).enabled) return request.throw(403, '碎语发布已关闭。');
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20000) {
      return request.throw(400, '请输入 1 至 20000 字的微博内容。');
    }
    // Author, kind, visibility and source are server-owned for this simple composer.
    const item = await this.say.create({kind: 'text', status: 'public', text: body.text,
      source: 'Firekylin', allowComments: false}, identity.id);
    return {success: true, id: item.id};
  }
}

function renderComposer(identity, enabled) {
  if (!enabled) return '';
  if (!identity.loggedIn) return '<section class="say-item"><a href="/admin/login?redirect=%2Fsays">登录</a></section>';
  if (!identity.canPublish) return '';
  return `<section class="say-item" aria-labelledby="say-publish-title"><h2 id="say-publish-title">发布微博</h2>
    <form id="say-publish-form" data-csrf="${esc(identity.csrf)}">
    <label for="say-publish-text">分享此刻的想法</label>
    <textarea id="say-publish-text" name="text" required maxlength="20000" rows="4" placeholder="有什么新鲜事？支持 #标签" style="display:block;width:100%;box-sizing:border-box;margin:12px 0"></textarea>
    <button type="submit">公开发布</button><p id="say-publish-result" role="status" aria-live="polite"></p></form>
    <script>(() => {
      const form = document.getElementById('say-publish-form');
      const result = document.getElementById('say-publish-result');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button');
        if (button.disabled) return;
        button.disabled = true;
        result.textContent = '发布中…';
        try {
          const response = await fetch('/api/plugins/say/frontend-publish', {method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json', 'X-CSRF-Token': form.dataset.csrf},
            body: JSON.stringify({text: form.elements.text.value})});
          if (response.ok && (await response.json()).success) { location.assign('/says'); return; }
          result.textContent = response.status === 403 ? '无法发布，请确认登录账号和发布权限，刷新页面后重试。'
            : response.status === 400 ? '请输入 1 至 20000 字的微博内容。' : '发布未确认，请先刷新列表核对，勿立即重发。';
        } catch { result.textContent = '发布未确认，请先刷新列表核对，勿立即重发。'; }
        button.disabled = false;
      });
    })();</script></section>`;
}
module.exports = {FrontendPublish, renderComposer};
