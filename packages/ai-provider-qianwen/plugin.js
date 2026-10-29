'use strict';

const {DEFAULT_BASE_URL, normalizeBaseUrl, generate} = require('./lib/client');

const MODELS = [
  {id: 'qwen-plus', label: 'qwen-plus', capabilities: ['text']},
  {id: 'qwen-flash', label: 'qwen-flash', capabilities: ['text']},
  {id: 'custom', label: '自定义模型 ID', capabilities: ['text']},
  {id: 'qwen-image-2.0-pro', label: 'qwen-image-2.0-pro', capabilities: ['image']},
  {id: 'qwen-image-2.0', label: 'qwen-image-2.0', capabilities: ['image']}
];

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    let baseUrl = await ctx.ai.credentials.get('baseUrl') || DEFAULT_BASE_URL;
    let imageBaseUrl = await ctx.ai.credentials.get('imageBaseUrl') || '';
    let customModel = await ctx.ai.credentials.get('modelId') || '';

    ctx.ai.registerProvider({
      id: 'qianwen', label: '通义千问',
      description: '通过阿里云百炼 API 使用通义千问文本模型及图片生成和编辑模型。',
      logo: 'https://www.aliyun.com/favicon.ico',
      models: MODELS,
      usageAdapter: {protocol: 'chat-completions'},
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: () => ctx.ai.credentials.has('apiKey'),
      generate: async(request, {signal, reportUsage}) => generate({
        apiKey: await ctx.ai.credentials.get('apiKey'), baseUrl, imageBaseUrl,
        request: {...request, model: request.model === 'custom' ? customModel : request.model}, signal, reportUsage
      })
    });

    ctx.admin.registerForm({
      id: 'settings', title: 'Provider 设置', submitLabel: '保存',
      fields: [
        {name: 'imageBaseUrl', type: 'url', label: '图片 API Base URL', description: '可选。工作空间地址以 /api/v1 结尾；留空则从文本 API 地址推导。'},
        {name: 'apiKey', type: 'password', label: 'API Key', description: '留空则保留已保存的密钥。'},
        {name: 'baseUrl', type: 'url', label: 'API Base URL', required: true},
        {name: 'modelId', type: 'text', label: '自定义模型 ID', description: '仅选择自定义模型时使用。'}
      ],
      load: async() => ({baseUrl, imageBaseUrl, modelId: customModel}),
      submit: async values => {
        const nextImageBaseUrl = values.imageBaseUrl ? normalizeBaseUrl(String(values.imageBaseUrl)) : '';
        await ctx.ai.credentials.set('imageBaseUrl', nextImageBaseUrl);
        imageBaseUrl = nextImageBaseUrl;
        const nextBaseUrl = normalizeBaseUrl(String(values.baseUrl || DEFAULT_BASE_URL));
        if (values.apiKey) await ctx.ai.credentials.set('apiKey', String(values.apiKey).trim());
        const nextModel = String(values.modelId || '').trim();
        await ctx.ai.credentials.set('baseUrl', nextBaseUrl);
        await ctx.ai.credentials.set('modelId', nextModel);
        baseUrl = nextBaseUrl;
        customModel = nextModel;
        return {message: '通义千问 设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'test-connection', label: '测试连接', type: 'primary',
      handler: async input => {
        const providers = await ctx.ai.providers();
        const selected = providers.find(provider => provider.id === 'qianwen')?.models
          .find(model => model.selected)?.id;
        const model = input?.model || selected || MODELS[0].id;
        if (!MODELS.some(item => item.id === model)) throw new TypeError('Invalid 通义千问 model');
        if (model === 'custom' && !customModel) throw new TypeError('Custom model ID is required');
        const testModel = MODELS.find(item => item.id === model).capabilities.includes('text') ? model : MODELS[0].id;
        const result = await ctx.ai.generate({
          provider: 'qianwen', model: testModel,
          messages: [{role: 'user', content: 'Reply with OK only.'}],
          maxOutputTokens: 512
        });
        return {message: `连接成功：${result.model}`};
      }
    });
  }
};
