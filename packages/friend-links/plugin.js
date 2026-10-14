'use strict';

const {FriendLinksService} = require('./lib/friend-links-service');
const {renderFriendLinksPage} = require('./lib/render');

let service;
const linkFields = [
  {name: 'id', type: 'hidden', label: '链接 ID'},
  {name: 'name', type: 'text', label: '站点名称', required: true},
  {name: 'url', type: 'url', label: '站点地址', required: true},
  {name: 'avatar', type: 'url', label: '头像 / Logo 地址'},
  {name: 'description', type: 'textarea', label: '站点描述'},
  {name: 'category', type: 'text', label: '分类', required: true},
  {name: 'enabled', type: 'switch', label: '显示此链接'}
];

function emptyLink() {
  return {id: '', name: '', url: '', avatar: '', description: '', category: '默认分类', enabled: true};
}

module.exports = {
  register(ctx) {
    service = new FriendLinksService({getModel: name => think.model(name), now: () => think.datetime()});
    class FriendLinksWidget extends ctx.widgets.Widget {
      async execute() {
        const result = await service.list({...this.parameter, publicOnly: true});
        this.pushAll(result.items);
      }
    }
    ctx.widgets.register('Widget_Plugin_Friend_Links', FriendLinksWidget);
    ctx.templates.registerFunction('friendLinks.list', args => service.list({...args || {}, publicOnly: true}));
    ctx.routes.register({method: 'GET', path: '/list', csrf: false, handler: ({query}) =>
      service.list({...query, publicOnly: true})});
    ctx.routes.register({method: 'GET', path: '/links', scope: 'site', csrf: false, handler: async({ctx: request}) => {
      const result = await service.list({publicOnly: true, pageSize: 200});
      const options = await think.model('options').getOptions();
      request.type = 'text/html; charset=utf-8';
      request.body = renderFriendLinksPage(result.items, {title: options.title ? `${options.title} · 友情链接` : '友情链接'});
    }});

    ctx.admin.registerPanel({id: 'friend-links', title: '友情链接', icon: 'contact', order: 76});
    ctx.admin.registerPage({id: 'manage', panel: 'friend-links', title: '链接管理', description: '新增、编辑、隐藏或删除友情链接。',
      load: async() => {
        const result = await service.list({pageSize: 200});
        const lastIndex = result.items.length - 1;
        return {sections: [
          {type: 'table', title: `全部链接（共 ${result.total} 个）`, rowKey: 'id', columns: [
            {key: 'id', title: 'ID'}, {key: 'name', title: '站点'}, {key: 'url', title: '地址'},
            {key: 'category', title: '分类'}, {key: 'statusLabel', title: '状态'},
            {key: 'operations', title: '操作', type: 'actions'}
          ], toolbar: [{label: '新增链接', href: '/admin/plugins/friend-links/edit', type: 'primary'}],
          rows: result.items.map((link, index) => ({...link, statusLabel: link.status === 'active' ? '显示' : '隐藏', operations: [
            {label: '上移', action: 'move-link', input: {id: link.id, direction: 'up'}, disabled: index === 0},
            {label: '下移', action: 'move-link', input: {id: link.id, direction: 'down'}, disabled: index === lastIndex},
            {label: '编辑', href: `/admin/plugins/friend-links/edit?id=${encodeURIComponent(link.id)}`},
            {label: '删除', action: 'delete-link', input: {id: link.id}, type: 'danger'}
          ]}))}
        ]};
      }});
    ctx.admin.registerPage({id: 'edit', panel: 'friend-links', title: '新增 / 编辑链接', description: '填写友情链接信息。'});
    ctx.admin.registerPage({id: 'settings', panel: 'friend-links', title: '链接设置', description: '配置公开页面和列表接口。',
      load: async() => ({sections: [
        {type: 'form', id: 'link-settings'},
        {type: 'markdown', title: '主题集成', content:
          '公开页面：`/links`；JSON API：`/api/plugins/friend-links/list`。\n\n' +
          '主题可调用 `friendLinks.list({ category: "分类名" })`，或使用 `Widget_Plugin_Friend_Links`。'}
      ]})});
    ctx.admin.registerForm({id: 'save-link', page: 'edit', title: '链接信息', submitLabel: '保存链接', fields: linkFields,
      load: async context => {
        const id = context.ctx.query.id;
        if (!id) return emptyLink();
        const link = await service.get(id);
        return {...link, enabled: link.status === 'active'};
      }, submit: async values => {
        const link = await service.save({...values, status: values.enabled === false ? 'inactive' : 'active'});
        return {message: `友情链接“${link.name}”已保存。`, item: link};
      }});
    ctx.admin.registerAction({id: 'move-link', page: 'manage', label: '移动', handler: async input => {
      await service.move(input.id, input.direction);
      return {message: '友情链接顺序已更新。'};
    }});
    ctx.admin.registerAction({id: 'delete-link', page: 'manage', label: '删除', type: 'danger',
      confirm: '确定要删除这个友情链接吗？', handler: async input => {
        await service.remove(input.id);
        return {message: '友情链接已删除。'};
      }});
    ctx.admin.registerForm({id: 'link-settings', page: 'settings', title: '公开设置', submitLabel: '保存设置', fields: [
      {name: 'enabled', type: 'switch', label: '启用公开页面和列表接口'},
      {name: 'pageSize', type: 'number', label: '默认每页数量', required: true}
    ], load: async() => service.settings(), submit: async values => {
      await service.saveSettings(values);
      return {message: '友情链接设置已保存。'};
    }});
  }
};
