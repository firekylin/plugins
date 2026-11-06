# Firekylin Ollama AI Provider

为 Firekylin「AI 连接」注册 Ollama 服务商，当前仅提供文本生成。安装后在「系统设置 → AI 连接」选择服务商，填写 配置参数，然后测试并保存连接。Ollama 地址相对于运行 Firekylin 的服务器；本地 HTTP 仅允许 loopback 地址。

API 参考：https://docs.ollama.com/api/chat

### 流式文本

文本生成支持 `onText(delta)` 增量回调（模型能力 `stream`），同时返回完整文本与最终用量。未传回调时保留普通 JSON 请求；图片请求仍使用原有接口。流错误、无输出或缺少协议结束标记会拒绝请求，取消信号传递给底层 fetch。自定义模型需要支持相应服务商的流式协议；此能力不代表支持博客工具调用。
