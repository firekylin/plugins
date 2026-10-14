'use strict';

const {
  RelatedPostService,
  injectRelatedPosts,
  renderRelatedPosts
} = require('./lib/related-post-service');

let service;

async function relatedHtml(controller, settings) {
  const archive = controller && controller.archive;
  const current = archive && archive.stack && archive.stack[0];
  if (!current) return '';
  const effectiveSettings = settings || await service.settings();
  const posts = await service.find(current, effectiveSettings);
  return renderRelatedPosts(posts, effectiveSettings.title);
}

module.exports = {
  register(ctx) {
    service = new RelatedPostService({
      getModel: name => think.model(name),
      now: () => think.datetime()
    });

    class RelatedPostsWidget extends ctx.widgets.Widget {
      async execute() {
        const postId = Number(this.parameter.postId || (this.controller.archive &&
          this.controller.archive.stack && this.controller.archive.stack[0] &&
          this.controller.archive.stack[0].id));
        if (!postId) return;
        const current = await this.model('post').where({id: postId}).find();
        if (!think.isEmpty(current)) this.pushAll(await service.find(current, await service.settings()));
      }

      get url() {
        return `/post/${encodeURIComponent(String(this.row.pathname || ''))}.html`;
      }
    }
    ctx.widgets.register('Widget_Plugin_Relate_Posts', RelatedPostsWidget);

    ctx.templates.registerFunction('relate-post.list', async(args, {controller}) => {
      const current = args && args.post ? args.post : controller.archive && controller.archive.stack[0];
      if (!current) return [];
      return service.find(current, {...await service.settings(), ...(args || {})});
    });
    ctx.templates.registerSlot('post.after', ({controller}) => relatedHtml(controller));

    ctx.events.on('theme.afterRender', async({controller, name}) => {
      if (name !== 'post' || typeof controller.ctx.body !== 'string') return;
      if (controller.ctx.body.includes('data-firekylin-plugin="relate-post"')) return;
      const settings = await service.settings();
      if (!settings.enabled || !settings.autoInject) return;
      controller.ctx.body = injectRelatedPosts(controller.ctx.body, await relatedHtml(controller, settings));
    });

    ctx.admin.registerPanel({id: 'relate-post', title: '相关文章', icon: 'favor', order: 76});
    ctx.admin.registerPage({
      id: 'settings', panel: 'relate-post', title: '相关文章设置',
      description: '按共同标签和分类为文章推荐相关内容。',
      load: async() => ({sections: [
        {type: 'form', id: 'relate-post-settings'},
        {type: 'markdown', title: '主题集成', content:
          '插件默认自动插入相关文章。主题也可以渲染 `post.after` slot，或调用 ' +
          '`Widget_Plugin_Relate_Posts`；检测到 slot 输出后不会重复插入。'}
      ]})
    });
    ctx.admin.registerForm({
      id: 'relate-post-settings', page: 'settings', title: '推荐设置', submitLabel: '保存设置',
      fields: [
        {name: 'enabled', type: 'switch', label: '启用相关文章'},
        {name: 'title', type: 'text', label: '区块标题', required: true},
        {name: 'limit', type: 'number', label: '显示数量', required: true,
          description: '允许 1–20 篇。'},
        {name: 'tagWeight', type: 'number', label: '共同标签权重', required: true,
          description: '每个共同标签增加的相关度分数。'},
        {name: 'categoryWeight', type: 'number', label: '共同分类权重', required: true,
          description: '每个共同分类增加的相关度分数。'},
        {name: 'fallback', type: 'switch', label: '无匹配时显示最新文章'},
        {name: 'autoInject', type: 'switch', label: '自动插入文章页',
          description: '未渲染 post.after slot 的主题会在文章页正文区域后自动插入。'}
      ],
      load: async() => service.settings(),
      submit: async values => {
        await service.saveSettings(values);
        return {message: '相关文章设置已保存。'};
      }
    });
  }
};
