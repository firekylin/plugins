'use strict';

const {FriendLinksService} = require('./lib/friend-links-service');
const {renderFriendLinksPage} = require('./lib/render');

let service;
const statusOptions = [{label: '显示', value: 'active'}, {label: '隐藏', value: 'inactive'}];
const linkFields = [
  {name: 'id', type: 'text', label: '链接 ID', description: '新增时留空；编辑时填写列表中的 ID。'},
  {name: 'name', type: 'text', label: '站点名称', required: true},
  {name: 'url', type: 'url', label: '站点地址', required: true},
  {name: 'avatar', type: 'url', label: '头像 / Logo 地址'},
  {name: 'description', type: 'textarea', label: '站点描述'},
  {name: 'category', type: 'text', label: '分类', required: true},
  {name: 'status', type: 'select', label: '状态', required: true, options: statusOptions},
  {name: 'order', type: 'number', label: '排序', description: '数字越小越靠前。'}
];

function emptyLink() {
  return {id: '', name: '', url: '', avatar: '', description: '', category: '默认分类', status: 'active', order: 0};
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
        return {sections: [
          {type: 'form', id: 'save-link'},
          {type: 'table', title: `全部链接（共 ${result.total} 个）`, rowKey: 'id', columns: [
            {key: 'id', title: 'ID'}, {key: 'name', title: '站点'}, {key: 'url', title: '地址'},
            {key: 'category', title: '分类'}, {key: 'statusLabel', title: '状态'}, {key: 'order', title: '排序'}
          ], rows: result.items.map(link => ({...link, statusLabel: link.status === 'active' ? '显示' : '隐藏'}))},
          {type: 'form', id: 'delete-link'},
          {type: 'divider', title: '公开设置'},
          {type: 'form', id: 'link-settings'},
          {type: 'markdown', title: '主题集成', content:
            '公开页面：`/links`；JSON API：`/api/plugins/friend-links/list`。\n\n' +
            '主题可调用 `friendLinks.list({ category: "分类名" })`，或使用 `Widget_Plugin_Friend_Links`。'}
        ]};
      }});
    ctx.admin.registerForm({id: 'save-link', page: 'manage', title: '新增或编辑链接', submitLabel: '保存链接', fields: linkFields,
      load: async() => emptyLink(), submit: async values => {
        const link = await service.save(values);
        return {message: `友情链接“${link.name}”已保存。`, item: link};
      }});
    ctx.admin.registerForm({id: 'delete-link', page: 'manage', title: '删除链接', submitLabel: '删除', fields: [
      {name: 'id', type: 'text', label: '链接 ID', required: true, description: '删除后无法恢复，请从上方列表复制 ID。'}
    ], load: async() => ({id: ''}), submit: async values => {
      await service.remove(values.id);
      return {message: '友情链接已删除。'};
    }});
    ctx.admin.registerForm({id: 'link-settings', page: 'manage', title: '公开设置', submitLabel: '保存设置', fields: [
      {name: 'enabled', type: 'switch', label: '启用公开页面和列表接口'},
      {name: 'pageSize', type: 'number', label: '默认每页数量', required: true}
    ], load: async() => service.settings(), submit: async values => {
      await service.saveSettings(values);
      return {message: '友情链接设置已保存。'};
    }});
  }
};
