# Firekylin Grok AI Provider

为 Firekylin「AI 连接」注册 Grok 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key 和 API Base URL，然后测试并保存连接。模型列表中的「自定义模型 ID」需要先填写对应的模型 ID；实际可用模型取决于账号与地域。

API 参考：https://docs.x.ai/developers/model-capabilities/legacy/chat-completions

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

Grok Imagine 图片编辑使用 JSON `/images/edits`，本插件每次支持一张参考图，返回 JPEG。

接口说明：https://docs.x.ai/developers/model-capabilities/images/editing

公共图片处理由 Firekylin core 通过服务商调用上下文的 `images` 提供，本插件不内置重复实现。请先升级到包含该 API 的 core（firekylin/firekylin#952），再升级插件；旧 core 的图片请求会明确提示需要升级，文本调用不受影响。

### 流式文本

文本生成支持 `onText(delta)` 增量回调（模型能力 `stream`），同时返回完整文本与最终用量。未传回调时保留普通 JSON 请求；图片请求仍使用原有接口。流错误、无输出或缺少协议结束标记会拒绝请求，取消信号传递给底层 fetch。自定义模型需要支持相应服务商的流式协议；此能力不代表支持博客工具调用。

流式调用要求 Firekylin core 提供 `context.streamResponse(response, protocol)`。Provider 返回原始流，由 core 统一解析、触发回调并保留用量；旧 core 会收到明确的升级提示。

## 聊天图片输入

grok-4.6 声明独立的 `vision` 能力，支持私有聊天图片及历史图片重放，覆盖流式与非流式。图片生成/编辑 `image` 不代表图片理解；自定义模型 ID 不自动获得视觉能力。图片理解仅接受 PNG/JPEG，WebP 在网络调用前明确拒绝，请先转换格式。

按照[官方图片接口](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions)发送内联图片，不创建公开 URL。需要先发布并安装支持 `context.vision.inputs` 的 Firekylin core（core#965），否则图片请求明确报错。core 负责图片解码、元数据清除、格式/大小限制及权限校验；此处适配不扩大聊天允许的文件类型和大小。测试使用模拟服务端与真实 core，未使用真实服务商凭据验证。
