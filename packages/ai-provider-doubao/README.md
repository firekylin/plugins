# Firekylin 豆包 AI Provider

为 Firekylin「AI 连接」注册 豆包 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key 和 API Base URL，然后测试并保存连接。模型列表中的「自定义模型 ID」需要先填写对应的模型 ID；实际可用模型取决于账号与地域。

API 参考：https://docs.volcengine.com/docs/ark/chat-api?lang=en

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

接口说明：https://docs.volcengine.com/docs/ark/image-generation-api

公共图片处理由 Firekylin core 通过服务商调用上下文的 `images` 提供，本插件不内置重复实现。请先升级到包含该 API 的 core（firekylin/firekylin#952），再升级插件；旧 core 的图片请求会明确提示需要升级，文本调用不受影响。

开发验证：设置 `FIREKYLIN_CORE_PATH=/absolute/path/to/firekylin` 后运行测试，图片测试直接使用 core 的实际实现；也可使用已安装、包含该 API 的 `firekylin` 包。
