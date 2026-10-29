'use strict';

const {baseUrl, generate} = require('./lib/client');

const MODELS = [
  {id: '@cf/openai/gpt-oss-20b', label: '@cf/openai/gpt-oss-20b', capabilities: ['text']},
  {id: 'custom', label: '自定义模型 ID', capabilities: ['text']},
  {id: '@cf/black-forest-labs/flux-2-klein-4b', label: '@cf/black-forest-labs/flux-2-klein-4b', capabilities: ['image']}
];

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    let accountId = await ctx.ai.credentials.get('accountId') || '';
    let customModel = await ctx.ai.credentials.get('modelId') || '';

    ctx.ai.registerProvider({
      id: 'cloudflare', label: 'Cloudflare Workers AI', description: '通过 Cloudflare Workers AI 使用文本模型及图片生成和编辑模型。',
      logo: 'https://www.cloudflare.com/favicon.ico', models: MODELS,
      usageAdapter: {protocol: 'chat-completions'},
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: async() => Boolean(accountId && await ctx.ai.credentials.has('apiKey')),
      generate: async(request, {signal, reportUsage, images}) => generate({
        apiKey: await ctx.ai.credentials.get('apiKey'), accountId,
        request: {...request, model: request.model === 'custom' ? customModel : request.model}, signal, reportUsage, images
      })
    });
    ctx.admin.registerForm({
      id: 'settings', title: 'Provider 设置', submitLabel: '保存',
      fields: [
        {name: 'apiKey', type: 'password', label: 'API Token', description: '留空则保留已保存的令牌。'},
        {name: 'accountId', type: 'text', label: 'Account ID', required: true},
        {name: 'modelId', type: 'text', label: '自定义模型 ID', description: '仅选择自定义模型时使用。'}
      ],
      load: async() => ({accountId, modelId: customModel}),
      submit: async values => {
        const nextAccountId = String(values.accountId || '').trim();
        baseUrl(nextAccountId);
        if (values.apiKey) await ctx.ai.credentials.set('apiKey', String(values.apiKey).trim());
        const nextModel = String(values.modelId || '').trim();
        await ctx.ai.credentials.set('accountId', nextAccountId);
        await ctx.ai.credentials.set('modelId', nextModel);
        accountId = nextAccountId;
        customModel = nextModel;
        return {message: 'Cloudflare Workers AI 设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'test-connection', label: '测试连接', type: 'primary',
      handler: async input => {
        const providers = await ctx.ai.providers();
        const selected = providers.find(provider => provider.id === 'cloudflare')?.models
          .find(model => model.selected)?.id;
        const model = input?.model || selected || MODELS[0].id;
        if (!MODELS.some(item => item.id === model)) throw new TypeError('Invalid Cloudflare Workers AI model');
        if (model === 'custom' && !customModel) throw new TypeError('Custom model ID is required');
        const testModel = MODELS.find(item => item.id === model).capabilities.includes('text') ? model : MODELS[0].id;
        const result = await ctx.ai.generate({
          provider: 'cloudflare', model: testModel, messages: [{role: 'user', content: 'Reply with OK only.'}],
          maxOutputTokens: 512
        });
        return {message: `连接成功：${result.model}`};
      }
    });
  }
};
