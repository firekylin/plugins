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
