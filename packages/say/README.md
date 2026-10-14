# Firekylin Say

一个适用于 Firekylin 的轻量微博/碎语插件。

## 功能

- 文本、图片、图文、语音、位置、链接和音乐七种内容类型
- 公开、私密、隐藏三种状态
- 从正文中的 `#标签` 自动提取标签，也可以手动填写
- 后台发布、查看、修改状态、删除和合并碎语
- 合并文本与图片、图文与图片、多张图片、文本与位置、文本与语音
- `/says` 独立公开页面，支持分页与标签筛选
- `/api/plugins/say/list` 公开 JSON API
- `say.list` Eta 模板函数和 `Widget_Plugin_Say` 主题 Widget
- 使用 API Key 的外部发布接口，可供浏览器扩展、快捷指令或机器人调用

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

图片和语音使用已经托管的 HTTPS URL。插件不会代表调用者下载远程文件，避免 SSRF、证书绕过和第三方存储凭据风险。
