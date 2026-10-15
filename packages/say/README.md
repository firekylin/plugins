# Firekylin Say

一个适用于 Firekylin 的轻量微博/碎语插件。

## 功能

- 文本、图片、图文、语音、位置、链接和音乐七种内容类型
- 公开、私密、隐藏三种状态
- 从正文中的 `#标签` 自动提取标签，也可以手动填写
- 后台发布、关键词搜索、分页查看、单条编辑、复制，以及基于复选框的批量状态、合并和删除操作
- 合并文本与图片、图文与图片、多张图片、文本与位置、文本与语音
- `/says` 独立公开页面和 `/says/tag/:tag` 标签页，支持分页、音乐卡片和位置地图
- `/api/plugins/say/list` 公开 JSON API
- `say.list` Eta 模板函数和 `Widget_Plugin_Say` 主题 Widget
- 使用 API Key 的外部发布接口，可供浏览器扩展、快捷指令或机器人调用
- 外部接口支持 base64 图片与语音，统一交给 Firekylin 当前配置的上传服务
- 自动识别网易云音乐歌曲地址并读取标题、作者和封面
- 企业微信加密回调，支持文本、图片、语音、位置、链接、表情替换以及 `/help`、`/merge` 命令

碎语保存在 Firekylin 的 `post` 表中，使用独立的 `type=3`，不会出现在文章、页面或附件列表里。

## 安装

```sh
pnpm add firekylin-plugin-say
```

重启 Firekylin 后，在后台打开 **碎语**。建议先到 **碎语 → 碎语设置** 设置外部发布 API Key。

## 外部发布

```sh
curl -X POST https://example.com/api/plugins/say/publish \
  -H 'Content-Type: application/json' \
  -H 'X-Say-API-Key: replace-with-your-key' \
  -d '{"kind":"text","status":"public","text":"从 API 发布 #Firekylin"}'
```

图片和语音既可以使用已经托管的 HTTPS URL，也可以传入 base64 数据。例如：

```json
{
  "kind": "image",
  "imageBase64": "data:image/jpeg;base64,...",
  "text": "带图片的碎语"
}
```

base64 媒体最大 20 MB，保存位置和服务由 Firekylin 的上传设置决定。插件不提供单独的存储路径配置。

## 企业微信

在插件设置中填写 CorpID、CorpSecret、Token 和 EncodingAESKey，然后将企业微信应用的接收消息地址设为：

```text
https://example.com/api/plugins/say/wecom
```

图片和语音会先从企业微信下载，再交给 Firekylin 当前配置的上传服务。AMR 语音会保留原始格式；能否直接播放取决于浏览器和存储服务返回的内容类型。

如需在位置碎语中显示静态地图，可选填高德地图 Web 服务 Key。插件不会配置额外的图片压缩服务。
