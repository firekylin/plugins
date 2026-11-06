# Firekylin Anthropic AI Provider

为 Firekylin「AI 连接」注册 Anthropic 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 API Key、配置参数，然后测试并保存连接。选择「自定义模型 ID」时需先填写对应 ID；实际可用模型取决于账号与地域。

API 参考：https://platform.claude.com/docs/en/api/messages/create

### 流式文本

文本生成支持 `onText(delta)` 增量回调（模型能力 `stream`），同时返回完整文本与最终用量。未传回调时保留普通 JSON 请求；图片请求仍使用原有接口。流错误、无输出或缺少协议结束标记会拒绝请求，取消信号传递给底层 fetch。自定义模型需要支持相应服务商的流式协议；此能力不代表支持博客工具调用。

流式调用要求 Firekylin core 的 `streamResponse.supportsCustomParser`。本插件的 `lib/stream-parser.js` 只转换协议事件和用量；core 负责读流、解码、大小限制、增量回调及取消。每次请求创建独立解析器；旧 core 会在发出流式请求前收到明确升级提示。

发布顺序：先正式发布包含自定义解析接口的 core，再合并插件发版 PR；仅合并 core 代码不等于已发布。普通生成与图片接口不依赖此扩展。

## 图片理解

内置模型 claude-sonnet-4-6 声明 `vision`，可读取私有聊天中发送的 PNG/JPEG/WebP 图片；`image` 仍表示图片生成/编辑。自定义 ID 不自动视为支持视觉输入。插件将每条用户消息中的 `images` 转为[服务商原生图片输入](https://platform.claude.com/docs/en/build-with-claude/vision)，包括历史图片、仅图片消息、流式与非流式路径，不创建公开 URL。

需要先正式发布并安装支持 `context.vision.inputs` 的 core 图片附件版本；旧 core 上的图片请求在网络调用前会报错，不会静默忽略图片。本改动基于 plugins#20 的流接口，保留其发布依赖。core 负责完整解码、元数据清除、大小和权限校验；本地模拟请求测试不代表真实服务商调用已验证。
