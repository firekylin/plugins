# Firekylin Vercel AI Gateway AI Provider

为 Firekylin「AI 连接」注册 Vercel AI Gateway 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key 和 API Base URL，然后测试并保存连接。模型列表中的「自定义模型 ID」需要先填写对应的模型 ID；实际可用模型取决于账号与地域。

API 参考：https://vercel.com/docs/ai-gateway/openai-compat/rest-api

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

当前声明的图片模型为 `google/gemini-3.1-flash-image-preview`，通过 Chat Completions 的 image modality 生成和编辑。自定义模型入口仍仅声明文本能力；图片专用模型的独立端点不在此入口内。

接口说明：https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/image-generation

公共图片处理由 Firekylin core 通过服务商调用上下文的 `images` 提供，本插件不内置重复实现。请先升级到包含该 API 的 core（firekylin/firekylin#952），再升级插件；旧 core 的图片请求会明确提示需要升级，文本调用不受影响。
