'use strict';

const {DEFAULT_BASE_URL, normalizeBaseUrl, generate} = require('./lib/client');

module.exports = {
  async register(ctx) {
    if (!ctx.ai) throw new Error('This plugin requires the Firekylin AI service API');
    let baseUrl = await ctx.ai.credentials.get('baseUrl') || DEFAULT_BASE_URL;
    let modelId = await ctx.ai.credentials.get('modelId') || '';

    ctx.ai.registerProvider({
      id: 'ollama', label: 'Ollama', description: '通过本地或自托管 Ollama API 使用文本模型。',
      logo: 'https://ollama.com/favicon.ico',
      models: [{id: 'local', label: '已配置的 Ollama 模型', capabilities: ['text']}],
      admin: {formId: 'settings', testActionId: 'test-connection'},
      configured: () => Boolean(modelId),
      generate: async(request, {signal}) => generate({
        baseUrl, request: {...request, model: modelId}, signal
      })
    });
    ctx.admin.registerForm({
      id: 'settings', title: 'Provider 设置', submitLabel: '保存',
      fields: [
        {name: 'baseUrl', type: 'url', label: 'Ollama API Base URL', required: true},
        {name: 'modelId', type: 'text', label: '模型 ID', required: true}
      ],
      load: async() => ({baseUrl, modelId}),
      submit: async values => {
        const nextBaseUrl = normalizeBaseUrl(String(values.baseUrl || DEFAULT_BASE_URL));
        const nextModel = String(values.modelId || '').trim();
        if (!nextModel) throw new TypeError('Ollama model ID is required');
        await ctx.ai.credentials.set('baseUrl', nextBaseUrl);
        await ctx.ai.credentials.set('modelId', nextModel);
        baseUrl = nextBaseUrl;
        modelId = nextModel;
        return {message: 'Ollama 设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'test-connection', label: '测试连接', type: 'primary',
      handler: async input => {
        if (input?.model && input.model !== 'local') throw new TypeError('Invalid Ollama model');
        if (!modelId) throw new TypeError('Ollama model ID is required');
        const result = await ctx.ai.generate({
          provider: 'ollama', model: 'local',
          messages: [{role: 'user', content: 'Reply with OK only.'}]
        });
        return {message: `连接成功：${result.model}`};
      }
    });
  }
};
