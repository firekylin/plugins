'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {BackupService} = require('./lib/backup-service');

let service;

function projectPath() {
  return process.env.FIREKYLIN_PROJECT_PATH || process.cwd();
}

function databaseConfig() {
  const model = think.config('model') || {};
  const adapter = model[model.type] || {};
  return {type: model.type, prefix: adapter.prefix || ''};
}

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

module.exports = {
  register(ctx) {
    service = new BackupService({
      getModel: name => think.model(name), database: databaseConfig(), projectPath: projectPath(),
      logger: ctx.logger, now: () => new Date()
    });
    ctx.admin.registerPanel({id: 'backup', title: '备份', icon: 'download', order: 85});
    ctx.admin.registerPage({
      id: 'backup', panel: 'backup', title: '数据库备份',
      description: '手动或定时创建可恢复的 SQL 数据库备份。',
      load: async() => {
        const [files, last] = await Promise.all([service.list(), service.last()]);
        const links = files.slice(0, 30).map(file => ({
          label: file.name,
          href: `/api/plugins/backup/download/${encodeURIComponent(file.name)}`,
          description: `${size(file.size)} · ${file.createdAt}`
        }));
        return {sections: [
          {type: 'markdown', title: '使用说明', content:
            '备份包含当前 Firekylin 数据库的表结构和数据。请定期测试恢复流程，并将至少一份副本保存在服务器之外。定时表达式使用 Cron 格式。'},
          ...(last ? [{type: 'description', title: '最近一次运行', items: [
            {label: '状态', value: last.ok ? '成功' : '失败'},
            {label: '时间', value: last.createdAt || ''},
            {label: '文件', value: last.filename || ''},
            {label: '详情', value: last.ok ? `${last.tables} 张表，${last.records} 条记录` : last.error}
          ]}] : []),
          {type: 'actions', ids: ['run-backup']},
          {type: 'form', id: 'backup-settings'},
          ...(links.length ? [{type: 'links', title: '本地备份', items: links}] :
            [{type: 'empty', description: '暂无本地备份'}])
        ]};
      }
    });
    ctx.admin.registerForm({
      id: 'backup-settings', page: 'backup', title: '备份设置', submitLabel: '保存设置',
      fields: [
        {name: 'enabled', type: 'switch', label: '启用定时备份'},
        {name: 'schedule', type: 'text', label: 'Cron 表达式', required: true,
          description: '例如每天 03:00：0 3 * * *'},
        {name: 'timezone', type: 'text', label: '时区', required: true,
          description: 'IANA 时区，例如 Asia/Shanghai 或 UTC'},
        {name: 'destination', type: 'select', label: '备份去向', required: true, options: [
          {label: '本地', value: 'local'}, {label: '邮件', value: 'email'}, {label: '本地和邮件', value: 'both'}
        ]},
        {name: 'directory', type: 'text', label: '本地目录', required: true,
          description: '相对路径以 Firekylin 项目目录为基准，也支持绝对路径。'},
        {name: 'retention', type: 'number', label: '本地保留份数', required: true},
        {name: 'emailTo', type: 'text', label: '收件人', description: '多个地址可用逗号分隔。'},
        {name: 'emailFrom', type: 'email', label: '发件人'},
        {name: 'smtpHost', type: 'text', label: 'SMTP 主机'},
        {name: 'smtpPort', type: 'number', label: 'SMTP 端口'},
        {name: 'smtpSecure', type: 'switch', label: 'SMTP TLS'},
        {name: 'smtpUser', type: 'text', label: 'SMTP 用户名'},
        {name: 'smtpPassword', type: 'password', label: 'SMTP 密码', description: '留空则保留已保存的密码。'}
      ],
      load: async() => service.config(),
      submit: async values => {
        await service.saveConfig(values);
        return {message: '备份设置已保存。'};
      }
    });
    ctx.admin.registerAction({
      id: 'run-backup', page: 'backup', label: '立即备份', type: 'primary',
      confirm: '立即创建数据库备份？',
      handler: async() => {
        const result = await service.run('manual');
        return {message: `备份完成：${result.filename}，${result.tables} 张表，${result.records} 条记录。`, result};
      }
    });
    ctx.routes.register({
      method: 'GET', path: '/download/:name', auth: 'admin', csrf: false,
      handler: async({ctx: request, params}) => {
        const file = await service.download(params.name);
        if (!file) return request.throw(404, 'Backup not found');
        request.type = 'application/sql';
        request.set('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
        request.body = fs.createReadStream(file);
      }
    });
    ctx.events.on('app.ready', () => service.start());
  },
  deactivate() { if (service) service.stop() }
};
