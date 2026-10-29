'use strict';

const {DEFAULT_BASE_URL, normalizeBaseUrl, generate} = require('./lib/client');

const MODELS = [
  {id: 'anthropic/claude-sonnet-4.6', label: 'anthropic/claude-sonnet-4.6', capabilities: ['text']},
  {id: 'openai/gpt-5.4', label: 'openai/gpt-5.4', capabilities: ['text']},
  {id: 'custom', label: '自定义模型 ID', capabilities: ['text']},
  {id: 'google/gemini-3.1-flash-image-preview', label: 'google/gemini-3.1-flash-image-preview', capabilities: ['image']}
];

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    let baseUrl = await ctx.ai.credentials.get('baseUrl') || DEFAULT_BASE_URL;
    let customModel = await ctx.ai.credentials.get('modelId') || '';

    ctx.ai.registerProvider({
      id: 'vercel-ai-gateway', label: 'Vercel AI Gateway',
      description: '通过 Vercel AI Gateway 调用多个服务商的文本模型及图片生成和编辑模型。',
      logo: 'https://vercel.com/favicon.ico',
      models: MODELS,
      usageAdapter: {protocol: 'chat-completions'},
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: () => ctx.ai.credentials.has('apiKey'),
      generate: async(request, {signal, reportUsage, images}) => generate({
        apiKey: await ctx.ai.credentials.get('apiKey'), baseUrl,
        request: {...request, model: request.model === 'custom' ? customModel : request.model}, signal, reportUsage, images
      })
    });

    ctx.admin.registerForm({
      id: 'settings', title: 'Provider 设置', submitLabel: '保存',
      fields: [
        {name: 'apiKey', type: 'password', label: 'API Key', description: '留空则保留已保存的密钥。'},
        {name: 'baseUrl', type: 'url', label: 'API Base URL', required: true},
        {name: 'modelId', type: 'text', label: '自定义模型 ID', description: '仅选择自定义模型时使用。'}
      ],
      load: async() => ({baseUrl, modelId: customModel}),
      submit: async values => {
        const nextBaseUrl = normalizeBaseUrl(String(values.baseUrl || DEFAULT_BASE_URL));
        if (values.apiKey) await ctx.ai.credentials.set('apiKey', String(values.apiKey).trim());
        const nextModel = String(values.modelId || '').trim();
        await ctx.ai.credentials.set('baseUrl', nextBaseUrl);
        await ctx.ai.credentials.set('modelId', nextModel);
        baseUrl = nextBaseUrl;
        customModel = nextModel;
        return {message: 'Vercel AI Gateway 设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'test-connection', label: '测试连接', type: 'primary',
      handler: async input => {
        const providers = await ctx.ai.providers();
        const selected = providers.find(provider => provider.id === 'vercel-ai-gateway')?.models
          .find(model => model.selected)?.id;
        const model = input?.model || selected || MODELS[0].id;
        if (!MODELS.some(item => item.id === model)) throw new TypeError('Invalid Vercel AI Gateway model');
        if (model === 'custom' && !customModel) throw new TypeError('Custom model ID is required');
        const testModel = MODELS.find(item => item.id === model).capabilities.includes('text') ? model : MODELS[0].id;
        const result = await ctx.ai.generate({
          provider: 'vercel-ai-gateway', model: testModel,
          messages: [{role: 'user', content: 'Reply with OK only.'}],
          maxOutputTokens: 512
        });
        return {message: `连接成功：${result.model}`};
      }
    });
  }
};
