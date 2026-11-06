# Firekylin Ollama AI Provider

为 Firekylin「AI 连接」注册 Ollama 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 配置参数，然后测试并保存连接。Ollama 地址相对于运行 Firekylin 的服务器；本地 HTTP 仅允许 loopback 地址。

API 参考：https://docs.ollama.com/api/chat

### 流式文本

文本生成支持 `onText(delta)` 增量回调（模型能力 `stream`），同时返回完整文本与最终用量。未传回调时保留普通 JSON 请求；图片请求仍使用原有接口。流错误、无输出或缺少协议结束标记会拒绝请求，取消信号传递给底层 fetch。自定义模型需要支持相应服务商的流式协议；此能力不代表支持博客工具调用。

流式调用要求 Firekylin core 提供 `context.streamResponse(response, protocol)`。Provider 返回原始流，由 core 统一解析、触发回调并保留用量；旧 core 会收到明确的升级提示。

## 聊天图片输入

local-vision（已配置的 Ollama 视觉模型） 声明独立的 `vision` 能力，支持私有聊天图片及历史图片重放，覆盖流式与非流式。图片生成/编辑 `image` 不代表图片理解；自定义模型 ID 不自动获得视觉能力。原 local 选项仍为文本模式；选择 local-vision 后，每个含图片请求先调用 /api/show 检查实际 modelId 的 capabilities 包含 vision，失败或不支持则在上传图片前拒绝。模型或地址更改后也重新检查，纯文本请求不增加检测请求。需要支持该能力字段的 Ollama 版本。

按照[官方图片接口](https://docs.ollama.com/capabilities/vision)发送内联图片，不创建公开 URL。需要先发布并安装支持 `context.vision.inputs` 的 Firekylin core（core#965），否则图片请求明确报错。core 负责图片解码、元数据清除、格式/大小限制及权限校验；此处适配不扩大聊天允许的文件类型和大小。测试使用模拟服务端与真实 core，未使用真实服务商凭据验证。
