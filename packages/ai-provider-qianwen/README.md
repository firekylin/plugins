# Firekylin 通义千问 AI Provider

为 Firekylin「AI 连接」注册 通义千问 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key 和 API Base URL，然后测试并保存连接。模型列表中的「自定义模型 ID」需要先填写对应的模型 ID；实际可用模型取决于账号与地域。

API 参考：https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope

## 图片生成和编辑（1.2.0）

通过 `capability: "image"` 调用插件列出的图片模型。`messages` 提供文本提示词；编辑时额外传入 `images: [{mimeType: "image/png", data: "<base64>"}]`，data 不包含 data URI 前缀。返回统一的 `images: [{mimeType, data}]`，调用方确认后自行上传入库。每次请求一次生成，不自动重试。连接测试使用文本模型，不触发图片生成。

Qwen Image 2.0 系列同时支持生成和编辑（最多 3 张参考图）。图片 API 地址默认将文本地址的 `/compatible-mode/v1` 替换为 `/api/v1`；如账号使用工作空间端点，请在「图片 API Base URL」填入对应地域的 `https://<WorkspaceId>.<region>.maas.aliyuncs.com/api/v1`。图片从服务商签名地址下载为 base64，不传递 API 密钥，不跟随重定向。

接口说明：https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-api
