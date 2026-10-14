'use strict';

const {CommentImporter} = require('./lib/importer');

const sourceOptions = [
  ['Waline', 'waline'], ['Valine', 'valine'], ['Artalk', 'artalk'], ['Twikoo', 'twikoo'],
  ['Gitalk (GitHub Issues)', 'gitalk'], ['Giscus (GitHub Discussions)', 'giscus'], ['Commento', 'commento']
].map(([label, value]) => ({label, value}));

function message(result) {
  const users = result.source === 'waline'
    ? ` Waline users: ${result.users.created} created, ${result.users.matched} matched, ` +
      `${result.users.socialLinked} social identities linked, ${result.users.socialConflicts} conflicts.`
    : '';
  if (result.dryRun) {
    return `Preview complete: ${result.importable} importable, ${result.skipped.unmatched} unmatched, ` +
      `${result.skipped.invalid + result.skipped.deleted} invalid or deleted.${users}`;
  }
  return `Imported ${result.imported} comments into ${result.affectedPosts} posts; ` +
    `skipped ${result.duplicates} duplicates and ${result.skipped.unmatched} unmatched comments.${users}`;
}

module.exports = {
  register(ctx) {
    ctx.admin.registerPanel({
      id: 'comment-import', title: '评论导入', icon: 'topic', order: 75
    });
    ctx.admin.registerPage({
      id: 'import', panel: 'comment-import', title: '第三方评论导入',
      description: '从 Waline、Valine、Artalk、Twikoo、Gitalk、Giscus 或 Commento 导入评论。',
      load: async() => ({
        notices: [{
          type: 'warning',
          message: '导入会写入评论作者、邮箱、IP 和正文。请先备份数据库，并确认你有权迁移这些数据。首次操作请启用预演。'
        }],
        sections: [
          {type: 'markdown', content:
            '粘贴来源系统导出的 JSON。插件会保留回复、审核状态、时间和点赞数，并跳过重复记录。' +
            'Waline 官方备份中的注册用户及社交登录也会迁移。Gitalk/Giscus 或路径与 Firekylin 不同的数据需要填写页面映射，格式见插件 README。'},
          {type: 'form', id: 'import-comments'}
        ]
      })
    });
    ctx.admin.registerForm({
      id: 'import-comments', page: 'import', title: '导入数据', submitLabel: '开始处理',
      fields: [
        {name: 'source', type: 'select', label: '来源系统', required: true, options: sourceOptions},
        {name: 'data', type: 'code', label: '评论 JSON', required: true,
          description: '最大 8 MiB、单次最多 50,000 条评论。GitHub 数据必须包含 comments/replies。'},
        {name: 'pageMap', type: 'code', label: '页面映射 JSON',
          description: '可选。键为源页面路径、Issue/Discussion ID、编号、URL 或标题，值为 Firekylin 文章路径或 ID。'},
        {name: 'defaultStatus', type: 'select', label: '缺失状态时使用', required: true, options: [
          {label: '已通过', value: 'approved'}, {label: '待审核', value: 'waiting'}, {label: '垃圾评论', value: 'spam'}
        ]},
        {name: 'dryRun', type: 'switch', label: '仅预演', description: '解析和匹配数据，但不写入数据库。'}
      ],
      load: async() => ({source: 'waline', data: '', pageMap: '{}', defaultStatus: 'approved', dryRun: true}),
      submit: async values => {
        try {
          const importer = new CommentImporter({
            getModel: name => think.model(name),
            now: () => think.datetime()
          });
          const result = await importer.run({...values, dryRun: values.dryRun === true});
          if (!result.dryRun && result.imported) await think.cache('post_1', null);
          return {message: message(result), result};
        } catch (error) {
          error.status = error.status || 400;
          throw error;
        }
      }
    });
  }
};
