# Comment Import

Firekylin 第三方评论导入插件。支持：

- Valine（LeanCloud `Comment` 类 JSON）
- Waline（控制台或数据库导出的 JSON）
- Twikoo（管理面板 JSON 备份）
- Artalk（评论 JSON）
- Gitalk（GitHub Issues + Comments API JSON）
- Giscus（GitHub GraphQL Discussions JSON）
- Commento（JSON 格式的 comments/commenters 数据）

不同版本的字段命名可能使用 camelCase 或 snake_case，插件会自动兼容。JSON Lines（每行一个 JSON 对象）也可以直接读取。

## 安装

在 Firekylin 项目目录中安装：

```bash
pnpm add @firekylin/comment-import
```

重启 Firekylin 后，以管理员身份访问：

```text
/api/plugins/comment-import/ui
```

也可以把本目录复制到 Firekylin 的 `plugins/comment-import/`。

## 使用方法

1. 在原评论系统中导出 JSON；Gitalk 使用 GitHub Issues REST API 的结果，并将每个 Issue 的 comments 放进同名字段；Giscus 使用 GitHub GraphQL API 的 Discussions 查询结果。
2. 选择来源与文件，点击“预览”。插件会根据完整 URL、`/post/<pathname>.html`、`/page/<pathname>.html`、pathname 或页面标题匹配文章。
3. 对无法自动匹配的旧 URL，可填写 `{"旧 URL": 文章 ID}` 手动映射。
4. 确认预览后执行导入。

插件保留作者、邮箱、个人链接、IP、UA、审核状态、点赞数、时间与父子关系。导入完成后会重新计算文章评论数。

## 安全与重复导入

- 所有页面和接口都要求管理员登录，写操作启用 Firekylin CSRF 校验。
- 默认最大文件大小为 20 MiB，可通过 Firekylin 的 `pluginConfig.comment-import.maxSourceBytes` 调整。
- 插件以文章、正文、作者邮箱/昵称及创建时间生成稳定指纹，重复导入不会再次写入相同评论。
- 未匹配文章的评论不会写入数据库；预览结果会列出这些页面。

## GitHub 数据结构示例

Gitalk：

```json
{
  "issues": [{
    "title": "文章标题",
    "pathname": "/post/hello.html",
    "comments": [{"id": 1, "body": "评论", "user": {"login": "alice"}, "created_at": "2026-01-01T00:00:00Z"}]
  }]
}
```

Giscus 可以直接使用 GraphQL 返回的 `data.repository.discussions.nodes[].comments.nodes[]` 结构，回复位于每条评论的 `replies.nodes`。

## 测试

```bash
pnpm --filter @firekylin/comment-import test
```
