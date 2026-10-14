'use strict';

const {SayService, secureEqual, strings} = require('./lib/say-service');
const {renderSayPage} = require('./lib/render');
const {resolveNeteaseMusic} = require('./lib/netease');
const {downloadWecomMedia, uploadBase64, uploadBuffer} = require('./lib/media');
const {decrypt, encryptedReply, parseXml, textReply, verify, xmlValue} = require('./lib/wecom');

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
  {name: 'url', type: 'url', label: '链接/音乐 URL', description: '音乐支持网易云音乐歌曲地址，可自动读取标题、作者和封面。'},
  {name: 'title', type: 'text', label: '链接/音乐标题'},
  {name: 'description', type: 'textarea', label: '链接描述'},
  {name: 'artist', type: 'text', label: '音乐作者'},
  {name: 'cover', type: 'url', label: '封面 URL'}
];
const textPublishFields = [
  {name: 'status', type: 'radio', label: '状态', required: true, options: statusOptions},
  {name: 'text', type: 'code', label: '内容', required: true, description: '使用 #标签 可自动提取标签。'}
];

function defaultPublish() {
  return {kind: 'text', status: 'public', text: '', tags: '', images: '', mediaUrl: '', latitude: '',
    longitude: '', label: '', url: '', title: '', description: '', artist: '', cover: ''};
}

function formValues(item) {
  return {...defaultPublish(), ...item, tags: (item.tags || []).join(', '), images: (item.images || []).join('\n')};
}

async function enrich(input) {
  return input.kind === 'music' ? resolveNeteaseMusic(input) : input;
}

function setCors(request) {
  request.set('Access-Control-Allow-Origin', '*');
  request.set('Access-Control-Allow-Headers', 'Content-Type, X-Say-API-Key');
  request.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

async function ingestApiMedia(body) {
  const input = {...body};
  const encodedImages = Array.isArray(body.imagesBase64) ? body.imagesBase64
    : body.imageBase64 ? [body.imageBase64] : [];
  if (encodedImages.length) {
    input.images = [...strings(body.images), ...await Promise.all(encodedImages.slice(0, 20).map((value, index) =>
      uploadBase64(value, {filename: `say-image-${Date.now()}-${index}.jpg`, mime: body.imageMime || 'image/jpeg'})))];
  }
  if (body.mediaBase64) input.mediaUrl = await uploadBase64(body.mediaBase64,
    {filename: body.mediaName || `say-voice-${Date.now()}.mp3`, mime: body.mediaMime || 'audio/mpeg'});
  return input;
}

function rawRequestBody(request, body) {
  if (typeof request.request.rawBody === 'string') return request.request.rawBody;
  if (Buffer.isBuffer(request.request.rawBody)) return request.request.rawBody.toString();
  if (typeof body === 'string') return body;
  if (body && typeof body.xml === 'string') return body.xml;
  return '';
}

function replaceEmoji(value) {
  const emoji = {'/::)': '🙂', '/::~': '😢', '/::B': '😎', '/::D': '😃', '/::P': '😛',
    '/:,@P': '😂', '/:,@-D': '😅', '/:heart': '❤️', '/:strong': '👍'};
  return Object.entries(emoji).reduce((text, [code, replacement]) => text.replaceAll(code, replacement), String(value || ''));
}

async function fromWecom(message, settings) {
  const type = message.MsgType.toLowerCase();
  if (type === 'text') {
    const text = replaceEmoji(message.Content).trim();
    if (text === '/help') return {reply: '发送文本、图片、语音、位置或链接即可发布碎语；/merge 1,2 可合并碎语。'};
    const merge = /^\/merge\s+(.+)$/i.exec(text);
    if (merge) {
      const item = await service.merge(merge[1]);
      return {reply: `已合并为碎语 #${item.id}`};
    }
    const musicUrl = text.match(/https?:\/\/(?:y\.)?music\.163\.com\/[^\s]+/i)?.[0];
    const input = musicUrl ? await enrich({kind: 'music', status: 'public', text: text.replace(musicUrl, '').trim(), url: musicUrl,
      source: '企业微信'}) : {kind: 'text', status: 'public', text, source: '企业微信'};
    return {item: await service.create(input, settings.authorId)};
  }
  if (type === 'image' || type === 'voice') {
    if (!settings.wecomCorpSecret) throw new Error('WeCom CorpSecret is not configured');
    const media = await downloadWecomMedia(message.MediaId, settings);
    const url = await uploadBuffer(media.buffer, media);
    const input = type === 'image' ? {kind: 'image', images: [url]} : {kind: 'voice', mediaUrl: url};
    return {item: await service.create({...input, status: 'public', source: '企业微信'}, settings.authorId)};
  }
  if (type === 'location') return {item: await service.create({kind: 'location', status: 'public',
    latitude: message.Location_X, longitude: message.Location_Y, label: message.Label, source: '企业微信'}, settings.authorId)};
  if (type === 'link') return {item: await service.create({kind: 'link', status: 'public', url: message.Url,
    title: message.Title, description: message.Description, cover: message.PicUrl, source: '企业微信'}, settings.authorId)};
  return {reply: `暂不支持企业微信消息类型：${type || 'unknown'}`};
}

async function wecomCallback({ctx: request, query, body}) {
  const settings = await service.settings();
  if (!settings.enabled || !settings.wecomCorpId || !settings.wecomToken || !settings.wecomEncodingAESKey) {
    return request.throw(503, 'WeCom callback is not configured');
  }
  if (request.method === 'GET') {
    if (!verify({token: settings.wecomToken, timestamp: query.timestamp, nonce: query.nonce,
      encrypted: query.echostr, msgSignature: query.msg_signature})) return request.throw(401, 'Invalid WeCom signature');
    request.type = 'text/plain; charset=utf-8';
    return decrypt(query.echostr, settings.wecomEncodingAESKey, settings.wecomCorpId);
  }
  const envelope = rawRequestBody(request, body);
  const encrypted = xmlValue(envelope, 'Encrypt');
  if (!encrypted || !verify({token: settings.wecomToken, timestamp: query.timestamp, nonce: query.nonce,
    encrypted, msgSignature: query.msg_signature})) return request.throw(401, 'Invalid WeCom signature');
  const message = parseXml(decrypt(encrypted, settings.wecomEncodingAESKey, settings.wecomCorpId));
  const result = await fromWecom(message, settings);
  const reply = textReply(message.FromUserName, message.ToUserName, result.reply || `碎语 #${result.item.id} 已发布`);
  request.type = 'application/xml; charset=utf-8';
  return encryptedReply(reply, settings);
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
    ctx.routes.register({method: 'OPTIONS', path: '/publish', csrf: false, handler: async({ctx: request}) => {
      setCors(request); request.status = 204;
    }});
    ctx.routes.register({method: 'POST', path: '/publish', csrf: false, handler: async({ctx: request, body}) => {
      setCors(request);
      const settings = await service.settings();
      if (!settings.enabled) return request.throw(503, 'Say publishing is disabled');
      if (!secureEqual(request.get('X-Say-API-Key'), settings.apiKey)) return request.throw(401, 'Invalid API key');
      return service.create(await enrich(await ingestApiMedia({...body, source: body.source || 'API'})), settings.authorId);
    }});
    ctx.routes.register({method: ['GET', 'POST'], path: '/wecom', csrf: false, handler: wecomCallback});
    const renderPage = async(request, query, tag = '') => {
      const settings = await service.settings();
      const result = await service.list({...query, tag, publicOnly: true});
      const options = await think.model('options').getOptions();
      request.type = 'text/html; charset=utf-8';
      request.body = renderSayPage(result, {title: `${options.title || ''} · 碎语`, tag, amapKey: settings.amapKey});
    };
    ctx.routes.register({method: 'GET', path: '/says', scope: 'site', csrf: false,
      handler: async({ctx: request, query}) => renderPage(request, query, String(query.tag || ''))});
    ctx.routes.register({method: 'GET', path: '/says/tag/:tag', scope: 'site', csrf: false,
      handler: async({ctx: request, query, params}) => renderPage(request, query, params.tag)});

    ctx.admin.registerPanel({id: 'say', title: '碎语', icon: 'comment', order: 74});
    ctx.admin.registerPage({
      id: 'manage', panel: 'say', title: '碎语管理', description: '发布和管理轻量微博内容。',
      load: async() => {
        const result = await service.list({pageSize: 100});
        return {sections: [
          {type: 'table', title: `最近的碎语（共 ${result.total} 条）`, rowKey: 'id', pagination: true,
            toolbar: [{label: '新增碎语', href: '/admin/plugins/say/publish', type: 'primary'}], columns: [
            {key: 'id', title: 'ID'}, {key: 'kind', title: '类型'}, {key: 'status', title: '状态'},
            {key: 'content', title: '内容'}, {key: 'tags', title: '标签'}, {key: 'createdAt', title: '时间'},
            {key: 'actions', title: '操作', type: 'actions'}
          ], rows: result.items.map(item => ({id: item.id, kind: item.kind, status: item.status,
            content: item.text || item.title || item.url, tags: item.tags.map(tag => `#${tag}`).join(' '),
            createdAt: item.createdAt, actions: [
              {label: '编辑', href: `/admin/plugins/say/edit?id=${item.id}`},
              {label: item.status === 'public' ? '设为私密' : '设为公开', action: 'toggle-say',
                input: {id: item.id, status: item.status === 'public' ? 'private' : 'public'}},
              {label: '复制', action: 'duplicate-say', input: {id: item.id}},
              {label: '删除', action: 'delete-say', input: {id: item.id}, type: 'danger'}
            ]}))},
          {type: 'form', id: 'manage-says'},
          {type: 'markdown', title: '合并规则', content: '支持：文本 + 图片、图文 + 图片、多条图片、文本 + 位置、文本 + 语音。保留最早一条记录的 ID。'}
        ]};
      }
    });
    ctx.admin.registerPage({id: 'publish', panel: 'say', title: '发布碎语', description: '发布一条纯文本碎语。',
      load: async() => ({sections: [{type: 'form', id: 'publish-say'}]})});
    ctx.admin.registerPage({id: 'edit', panel: 'say', title: '编辑碎语', description: '修改单条碎语的内容与状态。',
      load: async() => ({sections: [{type: 'form', id: 'edit-say'}]})});
    ctx.admin.registerPage({
      id: 'settings', panel: 'say', title: '碎语设置', description: '设置公开列表、外部发布和企业微信回调。',
      load: async() => ({sections: [
        {type: 'form', id: 'say-settings'},
        {type: 'markdown', title: '使用方式', content:
          '公开页面：`/says`；标签页面：`/says/tag/标签`；JSON API：`/api/plugins/say/list`。主题可调用 `say.list` 或 `Widget_Plugin_Say`。\n\n' +
          '外部发布：向 `/api/plugins/say/publish` 发送 JSON，并通过 `X-Say-API-Key` 请求头传递密钥。可传 `imageBase64`、`imagesBase64` 或 `mediaBase64`，文件会交给 Firekylin 已配置的上传服务。\n\n' +
          '企业微信回调地址：`/api/plugins/say/wecom`。'}
      ]})
    });

    ctx.admin.registerForm({id: 'publish-say', page: 'publish', title: '碎语内容', submitLabel: '发布', fields: textPublishFields,
      load: async() => ({status: 'public', text: ''}), submit: async(values, context) => {
        const item = await service.create({...values, kind: 'text'}, context.user.id);
        return {message: `碎语 #${item.id} 已发布。`, item};
      }});
    ctx.admin.registerForm({id: 'manage-says', page: 'manage', title: '批量管理', submitLabel: '执行', fields: [
      {name: 'operation', type: 'select', label: '操作', required: true, options: [
        {label: '修改状态', value: 'status'}, {label: '合并', value: 'merge'}, {label: '删除', value: 'delete'}
      ]}, {name: 'ids', type: 'text', label: '碎语 ID', required: true, description: '多个 ID 使用逗号分隔。'},
      {name: 'status', type: 'select', label: '目标状态', options: statusOptions, description: '仅“修改状态”操作使用。'}
    ], load: async() => ({operation: 'status', ids: '', status: 'public'}), submit: values => service.manage(values)});
    ctx.admin.registerForm({id: 'edit-say', page: 'edit', title: '碎语内容', submitLabel: '保存修改',
      fields: [{name: 'id', type: 'hidden', label: 'ID', required: true}, ...publishFields],
      load: async context => formValues(await service.get(context.ctx.query.id)), submit: async values => {
        const item = await service.update(values.id, await enrich(values));
        return {message: `碎语 #${item.id} 已更新。`, item};
      }});
    ctx.admin.registerAction({id: 'toggle-say', page: 'manage', label: '切换状态',
      handler: async input => { await service.updateStatus(input.id, input.status); return {message: '碎语状态已更新。'} }});
    ctx.admin.registerAction({id: 'duplicate-say', page: 'manage', label: '复制', handler: async(input, context) => {
      const item = await service.duplicate(input.id, context.user.id); return {message: `已复制为碎语 #${item.id}。`};
    }});
    ctx.admin.registerAction({id: 'delete-say', page: 'manage', label: '删除', type: 'danger', confirm: '确定删除这条碎语吗？',
      handler: async input => ({message: `已删除 ${await service.remove(input.id)} 条碎语。`})});
    ctx.admin.registerForm({id: 'say-settings', page: 'settings', title: '基础设置', submitLabel: '保存设置', fields: [
      {name: 'enabled', type: 'switch', label: '启用公开列表和外部发布'},
      {name: 'pageSize', type: 'number', label: '每页数量', required: true},
      {name: 'authorId', type: 'number', label: '外部发布作者 ID', required: true},
      {name: 'apiKey', type: 'password', label: '外部发布 API Key', description: '留空会保留现有密钥。建议使用至少 32 位随机字符串。'},
      {name: 'amapKey', type: 'password', label: '高德地图 Web 服务 Key', description: '可选，用于在位置碎语中显示静态地图；留空仅显示位置文字。'},
      {name: 'wecomCorpId', type: 'text', label: '企业微信 CorpID'},
      {name: 'wecomCorpSecret', type: 'password', label: '企业微信 CorpSecret', description: '用于下载图片和语音；留空会保留原值。'},
      {name: 'wecomToken', type: 'password', label: '企业微信回调 Token', description: '留空会保留原值。'},
      {name: 'wecomEncodingAESKey', type: 'password', label: '企业微信 EncodingAESKey', description: '留空会保留原值。'}
    ], load: async() => service.settings(), submit: async values => {
      await service.saveSettings(values); return {message: '碎语设置已保存。'};
    }});
  }
};
