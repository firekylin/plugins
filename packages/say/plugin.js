'use strict';

const {randomUUID} = require('node:crypto');
const {SayService, secureEqual, strings} = require('./lib/say-service');
const {decrypt: decryptFeishu, eventToken: feishuEventToken, messageEvent: feishuMessageEvent,
  verify: verifyFeishu} = require('./lib/feishu');
const feishuReply = require('./lib/feishu-reply');
const feedback = require('./lib/publish-feedback');
const {whoami} = require('./lib/commands');
const {createQqWebhook} = require('./lib/qq-webhook');
const {renderSayPage, createSayViewModel} = require('./lib/render');
const {listUrl, tagUrl} = require('./lib/urls');
const {renderWalineComments} = require('./lib/comment-render');
const {SayComments} = require('./lib/comments');
const {FrontendPublish, renderComposer} = require('./lib/frontend-publish');
const {resolveNeteaseMusic} = require('./lib/netease');
const {downloadFeishuResource, downloadWechatImage, downloadWechatMedia, downloadWecomMedia,
  createMediaClient} = require('./lib/media');
const {decrypt, encryptedReply, parseXml, textReply, verify, xmlValue} = require('./lib/wecom');

let service;
let pluginLogger;
// Best-effort, process-local receipts; not a durable cross-instance deduplication store.
const feishuEvents = new Map();
const feishuInFlight = new Map();

const kindOptions = [
  ['文本', 'text'], ['图片', 'image'], ['图文', 'textpic'], ['语音', 'voice'],
  ['位置', 'location'], ['链接', 'link'], ['音乐', 'music']
].map(([label, value]) => ({label, value}));
const statusOptions = [
  {label: '公开', value: 'public'}, {label: '私密', value: 'private'}, {label: '隐藏', value: 'hidden'}
];
const publishFields = [
  {name: 'kind', type: 'radio', label: '类型', required: true, options: kindOptions},
  {name: 'status', type: 'radio', label: '状态', required: true, options: statusOptions},
  {name: 'allowComments', type: 'switch', label: '允许评论', description: '默认允许评论；提交后须后台审核。'},
  {name: 'text', type: 'code', label: '内容', description: '文本类型必填；其他类型可作为附言。使用 #标签 可自动提取标签。'},
  {name: 'tags', type: 'text', label: '标签', description: '可选，使用逗号分隔。'},
  {name: 'images', type: 'code', label: '图片 URL', required: true, visibleWhen: {field: 'kind', values: ['image', 'textpic']},
    description: '每行一个 URL，或填写 JSON 数组。'},
  {name: 'mediaUrl', type: 'url', label: '语音 URL', required: true, visibleWhen: {field: 'kind', values: ['voice']}},
  {name: 'latitude', type: 'text', label: '纬度', required: true, visibleWhen: {field: 'kind', values: ['location']},
    description: '范围 -90 到 90。'},
  {name: 'longitude', type: 'text', label: '经度', required: true, visibleWhen: {field: 'kind', values: ['location']},
    description: '范围 -180 到 180。'},
  {name: 'label', type: 'text', label: '位置名称', visibleWhen: {field: 'kind', values: ['location']}},
  {name: 'url', type: 'url', label: '链接/音乐 URL', required: true, visibleWhen: {field: 'kind', values: ['link', 'music']},
    description: '音乐支持网易云音乐歌曲地址，可自动读取标题、作者和封面。'},
  {name: 'title', type: 'text', label: '链接/音乐标题', visibleWhen: {field: 'kind', values: ['link', 'music']}},
  {name: 'description', type: 'textarea', label: '链接描述', visibleWhen: {field: 'kind', values: ['link']}},
  {name: 'artist', type: 'text', label: '音乐作者', visibleWhen: {field: 'kind', values: ['music']}},
  {name: 'cover', type: 'url', label: '封面 URL', visibleWhen: {field: 'kind', values: ['link', 'music']}}
];
const textPublishFields = [
  {name: 'status', type: 'radio', label: '状态', required: true, options: statusOptions},
  {name: 'allowComments', type: 'switch', label: '允许评论', description: '默认允许评论；提交后须后台审核。'},
  {name: 'text', type: 'code', label: '内容', required: true, description: '使用 #标签 可自动提取标签。'}
];

function defaultPublish() {
  return {kind: 'text', status: 'public', allowComments: true, text: '', tags: '', images: '', mediaUrl: '', latitude: '',
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

async function ingestApiMedia(body, userId, mediaClient) {
  const input = {...body};
  const encodedImages = Array.isArray(body.imagesBase64) ? body.imagesBase64
    : body.imageBase64 ? [body.imageBase64] : [];
  if (encodedImages.length) {
    input.images = [...strings(body.images), ...await Promise.all(encodedImages.slice(0, 20).map((value, index) =>
      mediaClient.uploadBase64(value, {filename: `say-image-${Date.now()}-${index}.jpg`,
        mime: body.imageMime || 'image/jpeg', userId})))];
  }
  if (body.mediaBase64) input.mediaUrl = await mediaClient.uploadBase64(body.mediaBase64,
    {filename: body.mediaName || `say-voice-${Date.now()}.mp3`, mime: body.mediaMime || 'audio/mpeg', userId});
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

async function fromWecom(message, settings, mediaClient) {
  const identity = message.MsgType.toLowerCase() === 'text' && whoami('wecom', message.Content, message.FromUserName);
  if (identity) return identity;
  const type = message.MsgType.toLowerCase();
  if (type === 'text') {
    const text = replaceEmoji(message.Content).trim();
    if (text === '/help') return {reply: feedback.help};
    const merge = /^\/merge\s+(.+)$/i.exec(text);
    if (merge) {
      const item = await feedback.step('merge', () => service.merge(merge[1]));
      return {item, action: 'merge'};
    }
    const musicUrl = text.match(/https?:\/\/(?:y\.)?music\.163\.com\/[^\s]+/i)?.[0];
    const input = musicUrl ? await feedback.step('enrich', () => enrich({kind: 'music', status: 'public', text: text.replace(musicUrl, '').trim(), url: musicUrl,
      source: '企业微信'})) : {kind: 'text', status: 'public', text, source: '企业微信'};
    return {item: await feedback.step('save', () => service.create(input, settings.authorId))};
  }
  if (type === 'image' || type === 'voice') {
    if (!settings.wecomCorpSecret) throw new Error('WeCom CorpSecret is not configured');
    const media = await feedback.step('download', () => downloadWecomMedia(message.MediaId, settings));
    const url = await feedback.step('upload', () => mediaClient.uploadBuffer(media.buffer, {...media, userId: settings.authorId}));
    const input = type === 'image' ? {kind: 'image', images: [url]} : {kind: 'voice', mediaUrl: url};
    return {item: await feedback.step('save', () => service.create({...input, status: 'public', source: '企业微信'}, settings.authorId))};
  }
  if (type === 'location') return {item: await feedback.step('save', () => service.create({kind: 'location', status: 'public',
    latitude: message.Location_X, longitude: message.Location_Y, label: message.Label, source: '企业微信'}, settings.authorId))};
  if (type === 'link') return {item: await feedback.step('save', () => service.create({kind: 'link', status: 'public', url: message.Url,
    title: message.Title, description: message.Description, cover: message.PicUrl, source: '企业微信'}, settings.authorId))};
  return {reply: feedback.unsupported};
}

async function wecomCallback({ctx: request, query, body}, mediaClient) {
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
  const content = await feedback.receive(() => fromWecom(message, settings, mediaClient), `wecom:${message.MsgId || message.CreateTime}`, pluginLogger);
  const reply = textReply(message.FromUserName, message.ToUserName, content);
  request.type = 'application/xml; charset=utf-8';
  return encryptedReply(reply, settings);
}

function wechatReply(message, content, settings) {
  const reply = textReply(message.FromUserName, message.ToUserName, content);
  return encryptedReply(reply, {wecomEncodingAESKey: settings.wechatEncodingAESKey,
    wecomCorpId: settings.wechatAppId, wecomToken: settings.wechatToken});
}

async function fromWechat(message, settings, mediaClient) {
  const identity = message.MsgType.toLowerCase() === 'text' && whoami('wechat', message.Content, message.FromUserName);
  if (identity) return identity;
  const allowed = new Set(strings(settings.wechatAllowedOpenIds));
  if (!allowed.has(message.FromUserName)) {
    pluginLogger?.info?.(`say: rejected WeChat publisher OpenID ${message.FromUserName}`);
    return {reply: '当前微信账号没有发布碎语的权限。'};
  }
  const type = message.MsgType.toLowerCase();
  if (type === 'text') {
    const text = message.Content.trim();
    if (text === '/help') return {reply: feedback.help};
    const merge = /^\/merge\s+(.+)$/i.exec(text);
    if (merge) {
      const item = await feedback.step('merge', () => service.merge(merge[1]));
      return {item, action: 'merge'};
    }
    const musicUrl = text.match(/https?:\/\/(?:y\.)?music\.163\.com\/[^\s]+/i)?.[0];
    const input = musicUrl ? await feedback.step('enrich', () => enrich({kind: 'music', status: 'public',
      text: text.replace(musicUrl, '').trim(), url: musicUrl, source: '微信公众号'}))
      : {kind: 'text', status: 'public', text, source: '微信公众号'};
    return {item: await feedback.step('save', () => service.create(input, settings.authorId))};
  }
  if (type === 'image') {
    let media;
    try {
      media = await feedback.step('download', () => downloadWechatImage(message.PicUrl));
    } catch (error) {
      if (!settings.wechatAppSecret) throw error;
      media = await feedback.step('download', () => downloadWechatMedia(message.MediaId, settings));
    }
    const url = await feedback.step('upload', () => mediaClient.uploadBuffer(media.buffer, {...media, userId: settings.authorId}));
    return {item: await feedback.step('save', () => service.create({kind: 'image', images: [url], status: 'public',
      source: '微信公众号'}, settings.authorId))};
  }
  if (type === 'voice') {
    if (!settings.wechatAppSecret) throw new Error('WeChat AppSecret is not configured');
    const media = await feedback.step('download', () => downloadWechatMedia(message.MediaId, settings));
    const url = await feedback.step('upload', () => mediaClient.uploadBuffer(media.buffer, {...media, userId: settings.authorId}));
    return {item: await feedback.step('save', () => service.create({kind: 'voice', mediaUrl: url, status: 'public',
      source: '微信公众号'}, settings.authorId))};
  }
  if (type === 'location') return {item: await feedback.step('save', () => service.create({kind: 'location', status: 'public',
    latitude: message.Location_X, longitude: message.Location_Y, label: message.Label,
    source: '微信公众号'}, settings.authorId))};
  if (type === 'link') return {item: await feedback.step('save', () => service.create({kind: 'link', status: 'public', url: message.Url,
    title: message.Title, description: message.Description, source: '微信公众号'}, settings.authorId))};
  return {reply: feedback.unsupported};
}

async function wechatCallback({ctx: request, query, body}, mediaClient) {
  const settings = await service.settings();
  if (!settings.enabled || !settings.wechatAppId || !settings.wechatToken || !settings.wechatEncodingAESKey) {
    return request.throw(503, 'WeChat callback is not configured');
  }
  if (request.method === 'GET') {
    if (!verify({token: settings.wechatToken, timestamp: query.timestamp, nonce: query.nonce,
      encrypted: query.echostr, msgSignature: query.msg_signature})) return request.throw(401, 'Invalid WeChat signature');
    request.type = 'text/plain; charset=utf-8';
    return decrypt(query.echostr, settings.wechatEncodingAESKey, settings.wechatAppId);
  }
  const envelope = rawRequestBody(request, body);
  const encrypted = xmlValue(envelope, 'Encrypt');
  if (!encrypted || !verify({token: settings.wechatToken, timestamp: query.timestamp, nonce: query.nonce,
    encrypted, msgSignature: query.msg_signature})) return request.throw(401, 'Invalid WeChat signature');
  const message = parseXml(decrypt(encrypted, settings.wechatEncodingAESKey, settings.wechatAppId));
  const content = await feedback.receive(() => fromWechat(message, settings, mediaClient), `wechat:${message.MsgId || message.CreateTime}`, pluginLogger);
  request.type = 'application/xml; charset=utf-8';
  return wechatReply(message, content, settings);
}

function rawJsonRequestBody(request, body) {
  if (typeof request.request.rawBody === 'string') return request.request.rawBody;
  if (Buffer.isBuffer(request.request.rawBody)) return request.request.rawBody.toString();
  if (typeof body === 'string') return body;
  return JSON.stringify(body || {});
}

function feishuText(message) {
  if (message.messageType !== 'text') return '';
  let text = String(message.content.text || '');
  for (const mention of message.mentions) text = text.replaceAll(mention.key || '', '');
  return text.trim();
}

async function fromFeishu(message, settings, mediaClient) {
  const identity = whoami('feishu', feishuText(message), message.openId);
  if (identity) return identity;
  const source = '飞书';
  const save = async input => ({item: await feedback.step('save',
    () => service.create(input, settings.authorId)), action: 'publish'});
  if (message.messageType === 'text') {
    const text = feishuText(message);
    if (!text) return;
    if (text === '/help') return {reply: feedback.help};
    const merge = /^\/merge\s+(.+)$/i.exec(text);
    if (merge) return {item: await feedback.step('merge', () => service.merge(merge[1])), action: 'merge'};
    const musicUrl = text.match(/https?:\/\/(?:y\.)?music\.163\.com\/[^\s]+/i)?.[0];
    if (musicUrl) return save(await feedback.step('enrich', () => enrich({kind: 'music', status: 'public',
      text: text.replace(musicUrl, '').trim(), url: musicUrl, source})));
    if (/^https?:\/\/\S+$/.test(text)) {
      return save({kind: 'link', status: 'public', url: text, title: text, source});
    }
    return save({kind: 'text', status: 'public', text, source});
  }
  if (message.messageType === 'image') {
    const media = await feedback.step('download',
      () => downloadFeishuResource(message.messageId, message.content.image_key, 'image', settings));
    const url = await feedback.step('upload', () => mediaClient.uploadBuffer(media.buffer, {...media, userId: settings.authorId}));
    return save({kind: 'image', status: 'public', images: [url], source});
  }
  if (message.messageType === 'audio') {
    const media = await feedback.step('download',
      () => downloadFeishuResource(message.messageId, message.content.file_key, 'file', settings));
    const url = await feedback.step('upload', () => mediaClient.uploadBuffer(media.buffer, {...media, userId: settings.authorId}));
    return save({kind: 'voice', status: 'public', mediaUrl: url, source});
  }
  if (message.messageType === 'location') {
    return save({kind: 'location', status: 'public', latitude: message.content.latitude,
      longitude: message.content.longitude, label: message.content.name, source});
  }
  return {reply: feedback.unsupported};
}

async function feishuCallback({ctx: request, body}, mediaClient) {
  const settings = await service.settings();
  if (!settings.enabled || !settings.feishuAppId || !settings.feishuVerificationToken ||
      !settings.feishuEncryptKey) return request.throw(503, 'Feishu callback is not configured');
  const rawBody = rawJsonRequestBody(request, body);
  let payload;
  try {
    const envelope = typeof body === 'object' && body ? body : JSON.parse(rawBody);
    payload = envelope.encrypt ? decryptFeishu(envelope.encrypt, settings.feishuEncryptKey) : envelope;
  } catch {
    return request.throw(400, 'Invalid Feishu payload');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return request.throw(400, 'Invalid Feishu payload');
  }
  // URL verification is authenticated by its token, not the event signature.
  // Only this explicit request type may bypass ordinary event verification.
  if (payload.type === 'url_verification') {
    if (!secureEqual(payload.token, settings.feishuVerificationToken)) {
      return request.throw(401, 'Invalid Feishu verification token');
    }
    if (typeof payload.challenge !== 'string' || !payload.challenge) {
      return request.throw(400, 'Invalid Feishu challenge');
    }
    return {challenge: payload.challenge};
  }
  if (!verifyFeishu({timestamp: request.get('X-Lark-Request-Timestamp'),
    nonce: request.get('X-Lark-Request-Nonce'), encryptKey: settings.feishuEncryptKey, body: rawBody,
    value: request.get('X-Lark-Signature')})) return request.throw(401, 'Invalid Feishu signature');
  if (!secureEqual(feishuEventToken(payload), settings.feishuVerificationToken)) {
    return request.throw(401, 'Invalid Feishu verification token');
  }
  if (payload.header?.app_id && payload.header.app_id !== settings.feishuAppId) {
    return request.throw(401, 'Invalid Feishu app ID');
  }
  const message = feishuMessageEvent(payload);
  if (!message) return {};
  if (!/^om_[A-Za-z0-9_-]{1,256}$/.test(message.messageId)) return {};
  const eventKey = `${settings.feishuAppId}:${message.eventId || message.messageId}`;
  let receipt = feishuEvents.get(eventKey);
  if (!receipt) {
    let pending = feishuInFlight.get(eventKey);
    if (!pending) {
      pending = (async() => {
        let text;
        try {
          const result = await fromFeishu(message, settings, mediaClient);
          text = result?.reply || (result?.item ? feedback.success(result.item, result.action) : undefined);
        } catch (error) {
          text = feedback.failure(error, eventKey, pluginLogger);
        }
        const completed = {text, sent: false, pendingReply: null};
        // Store the publishing result before attempting a reply. A reply failure must
        // never make a webhook retry run the publishing operation again in this process.
        feishuEvents.set(eventKey, completed);
        if (feishuEvents.size > 1000) feishuEvents.delete(feishuEvents.keys().next().value);
        return completed;
      })();
      feishuInFlight.set(eventKey, pending);
    }
    try { receipt = await pending } finally { feishuInFlight.delete(eventKey) }
  }
  if (receipt.text && !receipt.sent) {
    if (!receipt.pendingReply) receipt.pendingReply = (async() => {
      try {
        await feishuReply.reply(message.messageId, receipt.text, eventKey, settings);
        receipt.sent = true;
      } catch (error) {
        pluginLogger?.error?.(`say: Feishu reply ${feedback.reference(eventKey)}: ${feedback.diagnostic(error, 'reply')} ${feedback.logDetails(error, 'reply')}`);
      }
    })();
    try { await receipt.pendingReply } finally { receipt.pendingReply = null }
  }
  return {};
}

module.exports = {
  register(ctx) {
    const mediaClient = createMediaClient(ctx.media);
    service = new SayService({getModel: name => think.model(name), now: () => think.datetime()});
    pluginLogger = ctx.logger;
    const comments = new SayComments({say: service, getModel: name => think.model(name),
      getService: name => think.service(name), now: value => think.datetime(value), logger: ctx.logger});
    ctx.events.on('comment.beforeCreate', data => comments.beforeNativeCreate(data));
    const publisher = new FrontendPublish({say: service, getModel: name => think.model(name),
      getService: name => think.service(name)});
    ctx.routes.register({method: 'POST', path: '/frontend-publish', auth: 'admin', csrf: true,
      handler: async({ctx: request, body}) => publisher.submit(request, body)});
    ctx.routes.register({method: 'POST', path: '/qq', csrf: false,
      handler: createQqWebhook({service, mediaClient, logger: ctx.logger, getModel: name => think.model(name)})});
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
      try {
        const input = await feedback.step('upload', () => ingestApiMedia({...body, source: body.source || 'API'}, settings.authorId, mediaClient));
        const enriched = await feedback.step('enrich', () => enrich(input));
        const item = await feedback.step('save', () => service.create(enriched, settings.authorId));
        return {...item, success: true, message: feedback.success(item)};
      } catch (error) {
        request.status = error.cause?.status === 400 ? 400 : 500;
        return {success: false, message: feedback.failure(error, `api:${randomUUID()}`, pluginLogger)};
      }
    }});
    ctx.routes.register({method: ['GET', 'POST'], path: '/wecom', csrf: false,
      handler: request => wecomCallback(request, mediaClient)});
    ctx.routes.register({method: ['GET', 'POST'], path: '/wechat', csrf: false,
      handler: request => wechatCallback(request, mediaClient)});
    ctx.routes.register({method: 'POST', path: '/feishu', csrf: false,
      handler: request => feishuCallback(request, mediaClient)});
    const renderPage = async(request, query, tag = '', renderTheme, listPath = listUrl) => {
      const settings = await service.settings();
      const result = await service.list({...query, tag, publicOnly: true});
      const options = await think.model('options').getOptions();
      const identity = await publisher.identity(request);
      request.set('Cache-Control', 'private, no-store');
      request.type = 'text/html; charset=utf-8';
      const viewModel = createSayViewModel(result, {title: `${options.title || ''} · 碎语`, tag, listPath,
        composer: renderComposer(identity, settings.enabled)});
      const html = typeof renderTheme === 'function' ? await renderTheme(viewModel.view, {say: viewModel}) : undefined;
      request.body = html === undefined ? renderSayPage(result, {viewModel, amapKey: settings.amapKey}) : html;
    };
    ctx.routes.register({method: 'GET', path: '/says', scope: 'site', csrf: false,
      handler: async({ctx: request, query, renderTheme}) => renderPage(request, query, String(query.tag || ''), renderTheme)});
    ctx.routes.register({method: 'GET', path: '/says/tag/:tag', scope: 'site', csrf: false,
      handler: async({ctx: request, query, params, renderTheme}) => renderPage(request, query, params.tag, renderTheme, tagUrl(params.tag))});

    ctx.routes.register({method: 'GET', path: '/comments/:id', csrf: false,
      handler: async({ctx: request, params, query}) => comments.handle(() => comments.list(params.id, query.page), request)});
    ctx.routes.register({method: 'POST', path: '/comments/:id', csrf: false,
      handler: async({ctx: request, params, body}) => comments.handle(() => comments.submit(params.id, body, request), request)});
    ctx.routes.register({method: 'GET', path: '/says/:id', scope: 'site', csrf: false,
      handler: async({ctx: request, params, renderTheme}) => {
        if (!/^[1-9]\d{0,14}$/.test(params.id)) return request.throw(404);
        const settings = await service.settings();
        const item = await service.get(params.id);
        if (!settings.enabled || item.status !== 'public') return request.throw(404);
        let section = '<p>评论已关闭。</p>';
        if (item.allowComments) {
          const config = await comments.configuration();
          section = renderWalineComments(item, config);
        }
        request.type = 'text/html';
        request.set('Cache-Control', 'no-store');
        const result = {items: [item], page: 1, pageSize: 1, total: 1};
        const viewModel = createSayViewModel(result, {view: 'detail', title: `碎语 #${item.id}`, section,
          navigation: await service.publicNeighbors(item.id)});
        const html = typeof renderTheme === 'function' ? await renderTheme('detail', {say: viewModel}) : undefined;
        request.body = html === undefined ? renderSayPage(result, {viewModel, amapKey: settings.amapKey}) : html;
      }});

    ctx.admin.registerPanel({id: 'say', title: '微博列表', icon: 'comment', order: 74});
    ctx.admin.registerPage({
      id: 'manage', panel: 'say', title: '微博列表', description: '发布和管理轻量微博内容。',
      load: async() => {
        const items = await service.all();
        return {sections: [
          {type: 'actions', ids: []},
          {type: 'table', title: `微博列表（共 ${items.length} 条）`, rowKey: 'id', pagination: true,
            search: {keys: ['content', 'tags'], placeholder: '搜索碎语'},
            selection: {input: 'ids', actions: [
              {key: 'public', label: '标记为公开', action: 'bulk-status', input: {status: 'public'}},
              {key: 'private', label: '标记为私密', action: 'bulk-status', input: {status: 'private'}},
              {key: 'hidden', label: '标记为隐藏', action: 'bulk-status', input: {status: 'hidden'}},
              {key: 'merge', label: '合并', action: 'merge-says'},
              {key: 'delete', label: '删除', action: 'delete-says', type: 'danger'}
            ]},
            toolbar: [{label: '新增碎语', href: '/admin/plugins/say/publish', type: 'primary'}], columns: [
            {key: 'id', title: 'ID'}, {key: 'kind', title: '类型'}, {key: 'status', title: '状态'},
            {key: 'content', title: '内容'}, {key: 'tags', title: '标签'}, {key: 'createdAt', title: '时间'},
            {key: 'actions', title: '操作', type: 'actions'}
          ], rows: items.map(item => ({id: item.id, kind: item.kind, status: item.status,
            content: item.text || item.title || item.url, tags: item.tags.map(tag => `#${tag}`).join(' '),
            createdAt: item.createdAt, actions: [
              {label: '编辑', href: `/admin/plugins/say/edit?id=${item.id}`},
              {label: item.status === 'public' ? '设为私密' : '设为公开', action: 'toggle-say',
                input: {id: item.id, status: item.status === 'public' ? 'private' : 'public'}},
              {label: '复制', action: 'duplicate-say', input: {id: item.id}},
              {label: '删除', action: 'delete-say', input: {id: item.id}, type: 'danger'}
            ]}))},
          {type: 'markdown', title: '合并规则', content: '支持：文本 + 图片、图文 + 图片、多条图片、文本 + 位置、文本 + 语音。保留最早一条记录的 ID。'}
        ]};
      }
    });
    ctx.admin.registerPage({id: 'publish', panel: 'say', title: '发布碎语', menu: false,
      description: '发布一条纯文本碎语。',
      load: async() => ({sections: [{type: 'form', id: 'publish-say'}]})});
    ctx.admin.registerPage({id: 'edit', panel: 'say', title: '编辑碎语', menu: false,
      description: '修改单条碎语的内容与状态。',
      load: async() => ({sections: [{type: 'form', id: 'edit-say'}]})});
    ctx.admin.registerPage({
      id: 'settings', title: '碎语设置', description: '设置公开列表和外部消息发布方式。',
      load: async() => ({sections: [
        {type: 'markdown', title: '发布方式配置', content:
          '外部 API、企业微信、微信公众号和飞书可以同时配置和使用，彼此不互斥。按需填写所需方式的配置即可，无需全部配置；完成后点击“保存全部设置”统一保存。'},
        {type: 'form', id: 'say-basic-settings'},
        {type: 'markdown', title: '外部发布接口', content:
          '向 `/api/plugins/say/publish` 发送 JSON，并通过 `X-Say-API-Key` 请求头传递密钥。可传 `imageBase64`、`imagesBase64` 或 `mediaBase64`，文件会交给 Firekylin 已配置的上传服务。'},
        {type: 'markdown', title: '消息平台回调设置', content:
          '- 企业微信：`/api/plugins/say/wecom`。\n' +
          '- 微信公众号：`/api/plugins/say/wechat`，服务器配置必须选择安全模式，并将发布者 OpenID 加入白名单。\n' +
          '- 飞书：`/api/plugins/say/feishu`，配置 Encrypt Key，订阅 `im.message.receive_v1`。任何能向机器人发送合规消息的人均可按配置作者发布。'},
        {type: 'markdown', title: '公开访问', content:
          '公开页面：`/says`；标签页面：`/says/tag/标签`；JSON API：`/api/plugins/say/list`。主题可调用 `say.list` 或 `Widget_Plugin_Say`。'}
      ]})
    });

    ctx.admin.registerForm({id: 'publish-say', page: 'publish', title: '碎语内容', submitLabel: '发布', fields: textPublishFields,
      load: async() => ({status: 'public', allowComments: true, text: ''}), submit: async(values, context) => {
        return feedback.adminResult(() => service.create({...values, kind: 'text'}, context.user.id),
          'publish', pluginLogger);
      }});
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
    ctx.admin.registerAction({id: 'bulk-status', page: 'manage', label: '修改状态', handler: async input => {
      await service.updateStatus(input.ids, input.status); return {message: '选中碎语的状态已更新。'};
    }});
    ctx.admin.registerAction({id: 'merge-says', page: 'manage', label: '合并', handler: async input => {
      return feedback.adminResult(() => service.merge(input.ids), 'merge', pluginLogger);
    }});
    ctx.admin.registerAction({id: 'delete-says', page: 'manage', label: '删除', type: 'danger',
      confirm: '确定删除选中的碎语吗？', handler: async input =>
        ({message: `已删除 ${await service.remove(input.ids)} 条碎语。`})});
    ctx.admin.registerForm({id: 'say-basic-settings', page: 'settings', title: '碎语设置',
      submitLabel: '保存全部设置', fields: [
      {name: 'enabled', type: 'switch', label: '启用公开列表和消息发布'},
      {name: 'pageSize', type: 'number', label: '每页数量', required: true},
      {name: 'authorId', type: 'number', label: '发布作者 ID', required: true,
        description: '外部 API、企业微信、微信公众号、飞书和 QQ 发布的碎语都会归属到这个用户。'},
      {name: 'amapKey', type: 'password', label: '高德地图 Web 服务 Key', description: '可选，用于在位置碎语中显示静态地图；留空仅显示位置文字。'},
      {name: 'apiKey', type: 'password', label: '外部发布 API Key',
        description: '留空会保留现有密钥。建议使用至少 32 位随机字符串。'},
      {name: 'wecomCorpId', type: 'text', label: '企业微信 CorpID'},
      {name: 'wecomCorpSecret', type: 'password', label: '企业微信 CorpSecret', description: '用于下载图片和语音；留空会保留原值。'},
      {name: 'wecomToken', type: 'password', label: '企业微信回调 Token', description: '留空会保留原值。'},
      {name: 'wecomEncodingAESKey', type: 'password', label: '企业微信 EncodingAESKey', description: '留空会保留原值。'},
      {name: 'wechatAppId', type: 'text', label: '公众号 AppID'},
      {name: 'wechatAppSecret', type: 'password', label: '公众号 AppSecret',
        description: '用于下载语音，以及图片 URL 不可用时下载临时素材；留空会保留原值。'},
      {name: 'wechatToken', type: 'password', label: '公众号回调 Token', description: '留空会保留原值。'},
      {name: 'wechatEncodingAESKey', type: 'password', label: '公众号 EncodingAESKey',
        description: '服务器配置需要选择安全模式；留空会保留原值。'},
      {name: 'wechatAllowedOpenIds', type: 'textarea', label: '公众号允许发布的 OpenID',
        description: '向公众号发送 /whoami 获取；每行或逗号分隔一个 OpenID，未列出的关注者不能发布碎语。'},
      {name: 'qqEnabled', type: 'switch', label: '启用 QQ 私聊发布',
        description: '官方机器人 Webhook；回调地址 /api/plugins/say/qq，适用于 Vercel。任何能向机器人发送合规私聊消息的人均可按配置作者发布。'},
      {name: 'qqSandbox', type: 'switch', label: 'QQ 沙箱环境', description: '测试机器人启用；IP 白名单可选，配置后需匹配实际出口 IP。'},
      {name: 'qqAppId', type: 'text', label: 'QQ 机器人 AppID'},
      {name: 'qqAppSecret', type: 'password', label: 'QQ 机器人 AppSecret', description: '留空保留原值；关闭 QQ 开关即可停止接收回调。'},
      {name: 'feishuAppId', type: 'text', label: '飞书 App ID'},
      {name: 'feishuAppSecret', type: 'password', label: '飞书 App Secret',
        description: '用于获取 tenant_access_token 和下载图片、音频；留空会保留原值。'},
      {name: 'feishuVerificationToken', type: 'password', label: '飞书 Verification Token',
        description: '在事件与回调的加密策略中获取；留空会保留原值。'},
      {name: 'feishuEncryptKey', type: 'password', label: '飞书 Encrypt Key',
        description: '用于回调签名校验和事件解密；留空保留原值。任何能向机器人发送合规消息的人均可按配置作者发布。'}
    ], load: async() => service.settings(), submit: async values => {
      await service.saveSettings(values);
      return {message: '全部设置已保存。'};
    }});
  }
};
