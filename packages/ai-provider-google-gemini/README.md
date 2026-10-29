# Firekylin Google Gemini AI Provider

为 Firekylin「AI 连接」注册 Google Gemini 服务商，支持文本生成（`gemini-3-flash-preview`）与图片生成（`gemini-3.1-flash-image`）。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key、配置参数，然后测试并保存连接。选择「自定义模型 ID」时需先填写对应 ID；自定义模型当前仅声明文本能力。实际可用模型取决于账号与地域。

图片调用示例：`ctx.ai.generate({provider: 'google-gemini', model: 'gemini-3.1-flash-image', capability: 'image', messages: [{role: 'user', content: '画一只猫'}]})`。返回的 `images` 数组包含 `{mimeType, data}`，其中 `data` 为 base64 编码的图片内容。图片不会自动保存到媒体库。测试连接始终使用文本模型，不会触发生图。

API 参考：https://ai.google.dev/api/generate-content
生图参考：https://ai.google.dev/gemini-api/docs/generate-content/image-generation

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

接口说明：https://ai.google.dev/gemini-api/docs/image-generation
