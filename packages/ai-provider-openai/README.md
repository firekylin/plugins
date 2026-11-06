# OpenAI AI Provider

Connects Firekylin's internal AI service API to the OpenAI Responses API. It requires a Firekylin build containing
the AI provider API from `firekylin/firekylin#919`; the package also fails closed when that API is unavailable.

After installation, open **AI 连接**, select **OpenAI**, save an API key and endpoint, then use **测试连接**.
Choose a model and explicitly set it as the global default on the same page; saving connection settings alone
does not change the default. Password fields are never returned to the browser after saving and the key
is stored through Firekylin's encrypted, plugin-scoped credential store.

For production, set `FIREKYLIN_AI_CREDENTIAL_KEY` to a stable secret before saving credentials.

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

GPT Image 使用 `/images/generations`；提供参考图时改用 multipart `/images/edits`，最多 16 张参考图，返回 PNG。文本继续使用 Responses API。

接口说明：https://developers.openai.com/api/docs/guides/image-generation

公共图片处理由 Firekylin core 通过服务商调用上下文的 `images` 提供，本插件不内置重复实现。请先升级到包含该 API 的 core（firekylin/firekylin#952），再升级插件；旧 core 的图片请求会明确提示需要升级，文本调用不受影响。

流式调用要求 Firekylin core 提供 `context.streamResponse(response, protocol)`。Provider 返回原始流，由 core 统一解析、触发回调并保留用量；旧 core 会收到明确的升级提示。

## 图片理解

内置模型 gpt-5.4、gpt-5-mini、gpt-5-nano、gpt-4.1 声明 `vision`，可读取私有聊天中发送的 PNG/JPEG/WebP 图片；`image` 仍表示图片生成/编辑。自定义 ID 不自动视为支持视觉输入。插件将每条用户消息中的 `images` 转为[服务商原生图片输入](https://developers.openai.com/api/docs/guides/images-vision)，包括历史图片、仅图片消息、流式与非流式路径，不创建公开 URL。

需要先正式发布并安装支持 `context.vision.inputs` 的 core 图片附件版本；旧 core 上的图片请求在网络调用前会报错，不会静默忽略图片。本改动基于 plugins#20 的流接口，保留其发布依赖。core 负责完整解码、元数据清除、大小和权限校验；本地模拟请求测试不代表真实服务商调用已验证。
