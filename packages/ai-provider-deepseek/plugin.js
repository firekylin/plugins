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
      id: 'deepseek', label: 'DeepSeek',
      description: '通过 DeepSeek API 使用 DeepSeek 文本生成模型。',
      logo: 'https://www.deepseek.com/favicon.ico',
      models: MODELS,
      usageAdapter: {protocol: 'chat-completions', fields: {
        cacheReadTokens: ['prompt_cache_hit_tokens', 'prompt_tokens_details.cached_tokens']
      }},
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: () => ctx.ai.credentials.has('apiKey'),
      generate: async(request, {signal, reportUsage}) => generate({
        apiKey: await ctx.ai.credentials.get('apiKey'), baseUrl, request, signal, reportUsage
      })
    });

    ctx.admin.registerForm({
      id: 'settings', title: 'Provider 设置', submitLabel: '保存',
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
      id: 'test-connection', label: '测试连接', type: 'primary',
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
