(function () {
  'use strict';
  if (window.FirekylinSayComments) return;
  const mounts = new WeakMap();
  let client, session;
  function load(config) {
    if (!client) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = config.resources.style;
      document.head.appendChild(style);
      client = import(config.resources.script);
    }
    if (!session) session = fetch('/api/comment/api/token', {credentials: 'same-origin'})
      .then(response => {
        if (!response.ok) throw new Error('session');
        return response.json();
      }).then(result => {
        if (result.errno !== 0) throw new Error('session');
        const user = result.data;
        if (user?.objectId) localStorage.setItem('WALINE_USER', JSON.stringify({...user, remember: true}));
        else localStorage.removeItem('WALINE_USER');
      });
    return Promise.all([client, session]).catch(error => {
      client = null;
      session = null;
      throw error;
    });
  }
  function mount(container, id, onCount) {
    if (mounts.has(container)) return mounts.get(container);
    const pending = (async () => {
      container.textContent = '评论加载中…';
      try {
        const response = await fetch('/api/plugins/say/comments/' + encodeURIComponent(id) + '/config', {credentials: 'same-origin'});
        const payload = await response.json();
        if ([403, 404].includes(response.status)) {
          container.textContent = '这条微博的评论尚未开放。';
          return;
        }
        if (!response.ok || !payload.success) throw new Error('config');
        if (!payload.data.native) {
          const link = document.createElement('a');
          link.href = '/says/' + encodeURIComponent(id);
          link.textContent = '当前核心暂不支持内嵌评论，前往详情页发表评论';
          container.replaceChildren(link);
          return;
        }
        const {config, target} = payload.data;
        const [waline] = await load(config);
        const refreshCount = async () => {
          if (!onCount) return;
          try {
            const query = new URLSearchParams({type: 'count', url: target});
            const result = await fetch('/api/comment/api/comment?' + query, {credentials: 'omit'}).then(r => r.json());
            const count = result.data?.[0];
            if (result.errno === 0 && Number.isFinite(count)) onCount(count);
          } catch { /* A count refresh must not retry a submitted comment. */ }
        };
        const options = {...config, el: container, comment: false, pageview: false};
        delete options.resources;
        delete options.loadError;
        container.replaceChildren();
        const instance = waline.init(options);
        await refreshCount();
        return instance;
      } catch {
        container.textContent = '评论暂时无法加载，请稍后重试。';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重新加载评论';
        retry.addEventListener('click', () => {
          mounts.delete(container);
          mount(container, id, onCount);
        });
        container.appendChild(retry);
      }
    })();
    mounts.set(container, pending);
    return pending;
  }
  window.FirekylinSayComments = {mount};
  document.querySelectorAll('[data-say-comments]').forEach(container => mount(container, container.dataset.sayComments));
})();
