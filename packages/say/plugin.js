'use strict';

const {SayService, secureEqual} = require('./lib/say-service');
const {renderSayPage} = require('./lib/render');

let service;

const kindOptions = [
  ['文本', 'text'], ['图片', 'image'], ['图文', 'textpic'], ['语音', 'voice'],
  ['位置', 'location'], ['链接', 'link'], ['音乐', 'music']
].map(([label, value]) => ({label, value}));
const statusOptions = [
  {label: '公开', value: 'public'}, {label: '私密', value: 'private'}, {label: '隐藏', value: 'hidden'}
];

const publishFields = [
  {name: 'kind', type: 'select', label: '类型', required: true, options: kindOptions},
  {name: 'status', type: 'select', label: '状态', required: true, options: statusOptions},
  {name: 'text', type: 'code', label: '内容', description: '文本类型必填；其他类型可作为附言。使用 #标签 可自动提取标签。'},
  {name: 'tags', type: 'text', label: '标签', description: '可选，使用逗号分隔。'},
  {name: 'images', type: 'code', label: '图片 URL', description: '图片/图文类型填写，每行一个 URL，或填写 JSON 数组。'},
  {name: 'mediaUrl', type: 'url', label: '语音 URL', description: '语音类型填写。'},
  {name: 'latitude', type: 'text', label: '纬度', description: '位置类型填写，范围 -90 到 90。'},
  {name: 'longitude', type: 'text', label: '经度', description: '位置类型填写，范围 -180 到 180。'},
  {name: 'label', type: 'text', label: '位置名称'},
  {name: 'url', type: 'url', label: '链接/音乐 URL'},
  {name: 'title', type: 'text', label: '链接/音乐标题'},
  {name: 'description', type: 'textarea', label: '链接描述'},
  {name: 'artist', type: 'text', label: '音乐作者'},
  {name: 'cover', type: 'url', label: '封面 URL'}
];

function defaultPublish() {
  return {kind: 'text', status: 'public', text: '', tags: '', images: '', mediaUrl: '', latitude: '',
    longitude: '', label: '', url: '', title: '', description: '', artist: '', cover: ''};
}

module.exports = {
  register(ctx) {
    service = new SayService({getModel: name => think.model(name), now: () => think.datetime()});

    class SayWidget extends ctx.widgets.Widget {
      async execute() {
        const result = await service.list({publicOnly: true, page: this.parameter.page,
          pageSize: this.parameter.pageSize, tag: this.parameter.tag});
        this.pushAll(result.items);
      }
    }
    ctx.widgets.register('Widget_Plugin_Say', SayWidget);
    ctx.templates.registerFunction('say.list', args => service.list({...args, publicOnly: true}));

    ctx.routes.register({method: 'GET', path: '/list', csrf: false, handler: async({query}) =>
      service.list({...query, publicOnly: true})});
    ctx.routes.register({method: 'POST', path: '/publish', csrf: false, handler: async({ctx: request, body}) => {
      const settings = await service.settings();
      if (!settings.enabled) return request.throw(503, 'Say publishing is disabled');
      if (!secureEqual(request.get('X-Say-API-Key'), settings.apiKey)) return request.throw(401, 'Invalid API key');
      return service.create({...body, source: body.source || 'API'}, settings.authorId);
    }});
    ctx.routes.register({method: 'GET', path: '/says', scope: 'site', csrf: false, handler: async({ctx: request, query}) => {
      const result = await service.list({...query, publicOnly: true});
      const options = await think.model('options').getOptions();
      request.type = 'text/html; charset=utf-8';
      request.body = renderSayPage(result, {title: `${options.title || ''} · 碎语`, tag: String(query.tag || '')});
    }});

    ctx.admin.registerPanel({id: 'say', title: '碎语', icon: 'comment', order: 74});
    ctx.admin.registerPage({
      id: 'manage', panel: 'say', title: '碎语管理', description: '发布和管理轻量微博内容。',
      load: async() => {
        const result = await service.list({pageSize: 100});
        return {sections: [
          {type: 'form', id: 'publish-say'},
          {type: 'table', title: `最近的碎语（共 ${result.total} 条）`, rowKey: 'id', columns: [
            {key: 'id', title: 'ID'}, {key: 'kind', title: '类型'}, {key: 'status', title: '状态'},
            {key: 'content', title: '内容'}, {key: 'tags', title: '标签'}, {key: 'createdAt', title: '时间'}
          ], rows: result.items.map(item => ({id: item.id, kind: item.kind, status: item.status,
            content: item.text || item.title || item.url, tags: item.tags.map(tag => `#${tag}`).join(' '),
            createdAt: item.createdAt}))},
          {type: 'form', id: 'manage-says'},
          {type: 'markdown', title: '合并规则', content: '支持：文本 + 图片、图文 + 图片、多条图片、文本 + 位置、文本 + 语音。保留最早一条记录的 ID。'}
        ]};
      }
    });
    ctx.admin.registerPage({
      id: 'settings', panel: 'say', title: '碎语设置', description: '设置公开列表和外部发布接口。',
      load: async() => ({sections: [
        {type: 'form', id: 'say-settings'},
        {type: 'markdown', title: '使用方式', content:
          '公开页面：`/says`；JSON API：`/api/plugins/say/list`。主题可调用 `say.list` 或 `Widget_Plugin_Say`。\n\n' +
          '外部发布：向 `/api/plugins/say/publish` 发送 JSON，并通过 `X-Say-API-Key` 请求头传递密钥。'}
      ]})
    });

    ctx.admin.registerForm({
      id: 'publish-say', page: 'manage', title: '发布碎语', submitLabel: '发布', fields: publishFields,
      load: async() => defaultPublish(),
      submit: async(values, context) => {
        const item = await service.create(values, context.user.id);
        return {message: `碎语 #${item.id} 已发布。`, item};
      }
    });
    ctx.admin.registerForm({
      id: 'manage-says', page: 'manage', title: '批量管理', submitLabel: '执行', fields: [
        {name: 'operation', type: 'select', label: '操作', required: true, options: [
          {label: '修改状态', value: 'status'}, {label: '合并', value: 'merge'}, {label: '删除', value: 'delete'}
        ]},
        {name: 'ids', type: 'text', label: '碎语 ID', required: true, description: '多个 ID 使用逗号分隔。'},
        {name: 'status', type: 'select', label: '目标状态', options: statusOptions,
          description: '仅“修改状态”操作使用。'}
      ],
      load: async() => ({operation: 'status', ids: '', status: 'public'}),
      submit: values => service.manage(values)
    });
    ctx.admin.registerForm({
      id: 'say-settings', page: 'settings', title: '基础设置', submitLabel: '保存设置', fields: [
        {name: 'enabled', type: 'switch', label: '启用公开列表和外部发布'},
        {name: 'pageSize', type: 'number', label: '每页数量', required: true},
        {name: 'authorId', type: 'number', label: '外部发布作者 ID', required: true},
        {name: 'apiKey', type: 'password', label: '外部发布 API Key',
          description: '留空会保留现有密钥。建议使用至少 32 位随机字符串。'}
      ],
      load: async() => service.settings(),
      submit: async values => {
        await service.saveSettings(values);
        return {message: '碎语设置已保存。'};
      }
    });
  }
};
