'use strict';

const {DEFAULT_BASE_URL, generate, normalizeBaseUrl} = require('./lib/client');

const MODELS = [
  {id: 'gpt-5.4', label: 'GPT-5.4', capabilities: ['text']},
  {id: 'gpt-5-mini', label: 'GPT-5 mini', capabilities: ['text']},
  {id: 'gpt-5-nano', label: 'GPT-5 nano', capabilities: ['text']},
  {id: 'gpt-4.1', label: 'GPT-4.1', capabilities: ['text']},
  {id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', capabilities: ['image']},
  {id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', capabilities: ['image']},
  {id: 'gpt-image-2', label: 'gpt-image-2', capabilities: ['image']},
  {id: 'gpt-image-1.5', label: 'gpt-image-1.5', capabilities: ['image']},
  {id: 'gpt-image-1-mini', label: 'gpt-image-1-mini', capabilities: ['image']}
];

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    let baseUrl = await ctx.ai.credentials.get('baseUrl') || DEFAULT_BASE_URL;

    ctx.ai.registerProvider({
      id: 'openai', label: 'OpenAI',
      description: '通过 OpenAI Responses API 生成文本，通过 Images API 生成和编辑图片。',
      logo: 'https://openai.com/favicon.ico',
      models: MODELS,
      usageAdapter: {protocol: 'responses'},
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: () => ctx.ai.credentials.has('apiKey'),
      generate: async(request, {signal, reportUsage, images}) => generate({
        apiKey: await ctx.ai.credentials.get('apiKey'), baseUrl, request, signal, reportUsage, images
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
        if (values.apiKey) await ctx.ai.credentials.set('apiKey', String(values.apiKey));
        baseUrl = normalizeBaseUrl(String(values.baseUrl || DEFAULT_BASE_URL));
        await ctx.ai.credentials.set('baseUrl', baseUrl);
        return {message: 'OpenAI 设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'test-connection', label: '测试连接', type: 'primary',
      handler: async input => {
        const providers = await ctx.ai.providers();
        const models = providers.find(provider => provider.id === 'openai')?.models || [];
        const requested = input && input.model;
        if (requested && !MODELS.some(item => item.id === requested)) throw new TypeError('Invalid OpenAI model');
        const selected = requested || models.find(item => item.selected)?.id || MODELS[0].id;
        const model = MODELS.find(item => item.id === selected)?.capabilities.includes('text') ? selected : MODELS[0].id;
        const reasoningModel = model !== 'gpt-4.1';
        const result = await ctx.ai.generate({
          provider: 'openai', model,
          messages: [{role: 'user', content: 'Reply with OK only.'}],
          ...(reasoningModel ? {reasoningEffort: 'low'} : {}),
          maxOutputTokens: reasoningModel ? 512 : 32
        });
        return {message: `连接成功：${result.model}`};
      }
    });
  }
};
