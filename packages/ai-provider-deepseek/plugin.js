'use strict';

const {DEFAULT_BASE_URL, generate, normalizeBaseUrl} = require('./lib/client');

const MODELS = [
  {id: 'deepseek-flash', label: 'DeepSeek Flash', capabilities: ['text']},
  {id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', capabilities: ['text']}
];

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    let baseUrl = await ctx.ai.credentials.get('baseUrl') || DEFAULT_BASE_URL;

    ctx.ai.registerProvider({
      id: 'deepseek', label: 'DeepSeek', models: MODELS,
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: () => ctx.ai.credentials.has('apiKey'),
      generate: async(request, {signal}) => generate({
        apiKey: await ctx.ai.credentials.get('apiKey'), baseUrl, request, signal
      })
    });

    ctx.admin.registerPanel({id: 'deepseek', title: 'DeepSeek', icon: 'robot', order: 71});
    ctx.admin.registerPage({
      id: 'settings', panel: 'deepseek', title: 'DeepSeek 设置', menu: false,
      description: '请在「AI 连接」页面配置 DeepSeek。',
      load: async() => ({sections: [
        {type: 'description', title: '连接状态', items: [
          {label: 'API Key', value: await ctx.ai.credentials.has('apiKey') ? '已配置' : '未配置'},
          {label: '接口地址', value: baseUrl}
        ]},
        {type: 'form', id: 'settings'},
        {type: 'actions', ids: ['test-connection']}
      ]})
    });
    ctx.admin.registerForm({
      id: 'settings', page: 'settings', title: 'Provider 设置', submitLabel: '保存',
      fields: [
        {name: 'apiKey', type: 'password', label: 'API Key', description: '留空则保留已保存的密钥。'},
        {name: 'baseUrl', type: 'url', label: 'API Base URL', required: true}
      ],
      load: async() => ({baseUrl}),
      submit: async values => {
        const nextBaseUrl = normalizeBaseUrl(String(values.baseUrl || DEFAULT_BASE_URL));
        if (values.apiKey) await ctx.ai.credentials.set('apiKey', String(values.apiKey));
        await ctx.ai.credentials.set('baseUrl', nextBaseUrl);
        baseUrl = nextBaseUrl;
        return {message: 'DeepSeek 设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'test-connection', page: 'settings', label: '测试连接', type: 'primary',
      handler: async input => {
        const providers = await ctx.ai.providers();
        const models = providers.find(provider => provider.id === 'deepseek')?.models || [];
        const requested = input && input.model;
        if (requested && !MODELS.some(item => item.id === requested)) throw new TypeError('Invalid DeepSeek model');
        const model = requested || models.find(item => item.selected)?.id || MODELS[0].id;
        const result = await ctx.ai.generate({
          provider: 'deepseek', model,
          messages: [{role: 'user', content: 'Reply with OK only.'}],
          disableThinking: true, maxOutputTokens: 32
        });
        return {message: `连接成功：${result.model}`};
      }
    });
  }
};
