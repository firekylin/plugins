'use strict';

const {DEFAULT_BASE_URL, normalizeBaseUrl, generate} = require('./lib/client');

const MODELS = [
  {id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', capabilities: ['text']},
  {id: 'custom', label: '自定义模型 ID', capabilities: ['text']}
];

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    let baseUrl = await ctx.ai.credentials.get('baseUrl') || DEFAULT_BASE_URL;
    let customModel = await ctx.ai.credentials.get('modelId') || '';

    ctx.ai.registerProvider({
      id: 'anthropic', label: 'Anthropic', description: '通过 Claude Messages API 使用 Anthropic 文本模型。',
      logo: 'https://www.anthropic.com/favicon.ico', models: MODELS,
      usageAdapter: {fields: {
        // Native input excludes cache creation and reads.
        inputTokens: {sum: ['input_tokens', {field: 'cache_creation_input_tokens', default: 0},
          {field: 'cache_read_input_tokens', default: 0}]},
        outputTokens: 'output_tokens', totalTokens: 'total_tokens',
        cacheReadTokens: 'cache_read_input_tokens', cacheWriteTokens: 'cache_creation_input_tokens'
      }},
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: () => ctx.ai.credentials.has('apiKey'),
      generate: async(request, {signal, reportUsage}) => generate({
        apiKey: await ctx.ai.credentials.get('apiKey'), baseUrl,
        request: {...request, model: request.model === 'custom' ? customModel : request.model}, signal, reportUsage
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
        return {message: 'Anthropic 设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'test-connection', label: '测试连接', type: 'primary',
      handler: async input => {
        const providers = await ctx.ai.providers();
        const selected = providers.find(provider => provider.id === 'anthropic')?.models
          .find(model => model.selected)?.id;
        const model = input?.model || selected || MODELS[0].id;
        if (!MODELS.some(item => item.id === model)) throw new TypeError('Invalid Anthropic model');
        if (model === 'custom' && !customModel) throw new TypeError('Custom model ID is required');
        const result = await ctx.ai.generate({
          provider: 'anthropic', model, messages: [{role: 'user', content: 'Reply with OK only.'}],
          maxOutputTokens: 2048
        });
        return {message: `连接成功：${result.model}`};
      }
    });
  }
};
