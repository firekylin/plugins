# Firekylin Cloudflare Workers AI AI Provider

为 Firekylin「AI 连接」注册 Cloudflare Workers AI 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key、配置参数，然后测试并保存连接。选择「自定义模型 ID」时需先填写对应 ID；实际可用模型取决于账号与地域。

API 参考：https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

FLUX.2 klein 4B 使用原生 multipart `ai/run`，支持最多 4 张参考图。服务商要求参考图不超过 512×512；插件输出设为 512×512，外部传入参考图须自行满足该尺寸限制。需要具有 Workers AI 权限的 Token。

接口说明：https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/

公共图片处理由 Firekylin core 通过服务商调用上下文的 `images` 提供，本插件不内置重复实现。请先升级到包含该 API 的 core（firekylin/firekylin#952），再升级插件；旧 core 的图片请求会明确提示需要升级，文本调用不受影响。

### 流式文本

文本生成支持 `onText(delta)` 增量回调（模型能力 `stream`），同时返回完整文本与最终用量。未传回调时保留普通 JSON 请求；图片请求仍使用原有接口。流错误、无输出或缺少协议结束标记会拒绝请求，取消信号传递给底层 fetch。自定义模型需要支持相应服务商的流式协议；此能力不代表支持博客工具调用。

流式调用要求 Firekylin core 提供 `context.streamResponse(response, protocol)`。Provider 返回原始流，由 core 统一解析、触发回调并保留用量；旧 core 会收到明确的升级提示。

## 聊天图片输入

新增 @cf/meta/llama-4-scout-17b-16e-instruct，独立声明 `vision`，按[官方模型文档](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/)及 OpenAI 兼容接口发送内联 `image_url` 数据块，覆盖历史图片、仅图片消息和流/非流回复。原有文本模型、自定义 ID、图片生成模型不自动获得图片理解能力。

依赖先发布安装 core#965 的 `context.vision.inputs`；旧 core 的图片请求明确报错，不静默忽略。图片不创建公开 URL，解码、大小、权限和审计隐私沿用 core 校验。已用真实 core 和模拟 API 验证，尚未进行真实服务商调用。
