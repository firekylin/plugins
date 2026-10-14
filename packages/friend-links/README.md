# Firekylin Friend Links

为 Firekylin 提供友情链接管理、公开展示和主题集成能力。

## 功能

- 在后台新增、编辑、隐藏和删除友情链接
- 保存站点名称、地址、头像、描述、分类和排序
- 自动校验 URL，只接受 HTTP 和 HTTPS 地址，并阻止重复链接
- 按分类、关键词筛选，按自定义顺序展示
- `/links` 独立公开页面
- `/api/plugins/friend-links/list` 公开 JSON API
- `friendLinks.list` Eta 模板函数和 `Widget_Plugin_Friend_Links` 主题 Widget

数据存储在 Firekylin 的 `options` 表中，不需要额外建表或执行迁移。

## 安装

```sh
pnpm add firekylin-plugin-friend-links
```

重启 Firekylin 后，在后台打开 **友情链接**，添加站点并调整公开设置。

## 主题集成

模板函数返回 `{ page, pageSize, total, items }`：

```js
await friendLinks.list({category: '朋友', pageSize: 100})
```

Widget 名称为 `Widget_Plugin_Friend_Links`，支持 `category`、`keyword`、`page` 和 `pageSize` 参数。隐藏的链接不会出现在公开页面、API、模板函数或 Widget 中。
