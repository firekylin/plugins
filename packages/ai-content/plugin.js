'use strict';

const {AIContentService, DEFAULTS, settings} = require('./lib/content-service');

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    const getSettings = async() => settings(await ctx.ai.credentials.get('settings'));
    const service = new AIContentService({generate: request => ctx.ai.generate(request), getSettings});

    ctx.admin.registerPanel({id: 'ai-content', title: 'AI 内容', icon: 'robot', order: 71});
    ctx.admin.registerPage({
      id: 'settings', panel: 'ai-content', title: 'AI 内容设置',
      description: '控制文章编辑器中的生成式 AI 功能。',
      load: async() => ({sections: [
        {type: 'markdown', content: '文章内容会发送到当前选中的 AI Provider。生成结果只写入编辑器，仍需人工检查并保存。'},
        {type: 'form', id: 'settings'}
      ]})
    });
    ctx.admin.registerForm({
      id: 'settings', page: 'settings', title: '功能开关', submitLabel: '保存',
      fields: [
        {name: 'summary', type: 'switch', label: '生成摘要'},
        {name: 'title', type: 'switch', label: '生成标题'},
        {name: 'rewrite', type: 'switch', label: '改写文章'},
        {name: 'translate', type: 'switch', label: '翻译文章'},
        {name: 'language', type: 'text', label: '翻译目标语言', required: true}
      ],
      load: getSettings,
      submit: async values => {
        const next = {...DEFAULTS, ...values, language: String(values.language || DEFAULTS.language).slice(0, 80)};
        await ctx.ai.credentials.set('settings', JSON.stringify(next));
        return {message: 'AI 内容设置已保存。'};
      }
    });

    const actions = [
      ['summary', '生成摘要'], ['title', '生成标题'], ['rewrite', '改写文章'], ['translate', '翻译文章']
    ];
    actions.forEach(([id, label], order) => {
      const action = `generate-${id}`;
      ctx.admin.registerAction({
        id: action, page: 'settings', label,
        handler: input => service.run(id, input)
      });
      ctx.admin.registerEditorAction({id, action, label, order: 10 + order});
    });
  }
};
