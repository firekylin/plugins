# DeepSeek AI Provider

Connects Firekylin's internal AI service API to DeepSeek's Chat Completions API. It requires a Firekylin build containing the AI provider API from `firekylin/firekylin#919` and fails closed without it.

After installation, open **AI 连接**, select **DeepSeek**, save your API key and click **测试连接**. You can also choose a model and explicitly set it as the global default on the same page. Saving connection settings alone does not change the default. The default endpoint is `https://api.deepseek.com`; a custom HTTPS endpoint can be configured. The saved key is never returned to the browser and is stored through Firekylin's encrypted, plugin-scoped credential store.

For production, set `FIREKYLIN_AI_CREDENTIAL_KEY` to a stable secret before saving credentials. The connection test makes a small, billable request to DeepSeek. Do not put API keys in Git or PR comments.

流式调用要求 Firekylin core 提供 `context.streamResponse(response, protocol)`。Provider 返回原始流，由 core 统一解析、触发回调并保留用量；旧 core 会收到明确的升级提示。

## 聊天图片输入

deepseek-flash 声明独立的 `vision` 能力，支持私有聊天图片及历史图片重放，覆盖流式与非流式。图片生成/编辑 `image` 不代表图片理解；自定义模型 ID 不自动获得视觉能力。deepseek-v4-pro 保持文本能力；Flash 图片历史与原有工具调用、工具结果兼容。

按照[官方图片接口](https://api-docs.deepseek.com/guides/vision/)发送内联图片，不创建公开 URL。需要先发布并安装支持 `context.vision.inputs` 的 Firekylin core（core#965），否则图片请求明确报错。core 负责图片解码、元数据清除、格式/大小限制及权限校验；此处适配不扩大聊天允许的文件类型和大小。测试使用模拟服务端与真实 core，未使用真实服务商凭据验证。
