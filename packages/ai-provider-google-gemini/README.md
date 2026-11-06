# Firekylin Google Gemini AI Provider

为 Firekylin「AI 连接」注册 Google Gemini 服务商，支持文本生成（`gemini-3-flash-preview`）与图片生成（`gemini-3.1-flash-image`）。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key、配置参数，然后测试并保存连接。选择「自定义模型 ID」时需先填写对应 ID；自定义模型当前仅声明文本能力。实际可用模型取决于账号与地域。

图片调用示例：`ctx.ai.generate({provider: 'google-gemini', model: 'gemini-3.1-flash-image', capability: 'image', messages: [{role: 'user', content: '画一只猫'}]})`。返回的 `images` 数组包含 `{mimeType, data}`，其中 `data` 为 base64 编码的图片内容。图片不会自动保存到媒体库。测试连接始终使用文本模型，不会触发生图。

API 参考：https://ai.google.dev/api/generate-content
生图参考：https://ai.google.dev/gemini-api/docs/generate-content/image-generation

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

接口说明：https://ai.google.dev/gemini-api/docs/image-generation

公共图片处理由 Firekylin core 通过服务商调用上下文的 `images` 提供，本插件不内置重复实现。请先升级到包含该 API 的 core（firekylin/firekylin#952），再升级插件；旧 core 的图片请求会明确提示需要升级，文本调用不受影响。

### 流式文本

文本生成支持 `onText(delta)` 增量回调（模型能力 `stream`），同时返回完整文本与最终用量。未传回调时保留普通 JSON 请求；图片请求仍使用原有接口。流错误、无输出或缺少协议结束标记会拒绝请求，取消信号传递给底层 fetch。自定义模型需要支持相应服务商的流式协议；此能力不代表支持博客工具调用。

流式调用要求 Firekylin core 的 `streamResponse.supportsCustomParser`。本插件的 `lib/stream-parser.js` 只转换协议事件和用量；core 负责读流、解码、大小限制、增量回调及取消。每次请求创建独立解析器；旧 core 会在发出流式请求前收到明确升级提示。

发布顺序：先正式发布包含自定义解析接口的 core，再合并插件发版 PR；仅合并 core 代码不等于已发布。普通生成与图片接口不依赖此扩展。

## 图片理解

内置模型 gemini-3-flash-preview 声明 `vision`，可读取私有聊天中发送的 PNG/JPEG/WebP 图片；`image` 仍表示图片生成/编辑。自定义 ID 不自动视为支持视觉输入。插件将每条用户消息中的 `images` 转为[服务商原生图片输入](https://ai.google.dev/api/generate-content)，包括历史图片、仅图片消息、流式与非流式路径，不创建公开 URL。

需要先正式发布并安装支持 `context.vision.inputs` 的 core 图片附件版本；旧 core 上的图片请求在网络调用前会报错，不会静默忽略图片。本改动基于 plugins#20 的流接口，保留其发布依赖。core 负责完整解码、元数据清除、大小和权限校验；本地模拟请求测试不代表真实服务商调用已验证。
