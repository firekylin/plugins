'use strict';

const {strings} = require('./say-service');

function fail(status, message) { throw Object.assign(new Error(message), {status, publicCommentError: true}) }
function idOf(value) {
  if (!/^[1-9]\d{0,14}$/.test(String(value))) fail(404, '碎语不存在。');
  return Number(value);
}

// Plugin-owned targets; no changes to the native article/page URL resolver.
class SayComments {
  constructor({say, getModel, getService, now, logger}) {
    this.say = say;
    this.getModel = getModel;
    this.getService = getService;
    this.now = now;
    this.logger = logger;
    this.pending = new Map();
  }

  async target(id, writing = false) {
    id = idOf(id);
    const settings = await this.say.settings();
    const item = await this.say.get(id);
    if (!settings.enabled || item.status !== 'public') fail(404, '碎语不存在。');
    if (!settings.commentsEnabled || !item.allowComments) fail(writing ? 403 : 404, '这条碎语的评论已关闭。');
    return item;
  }

  async configuration() {
    const options = await this.getModel('options').getOptions(true);
    const captcha = this.getService('captcha');
    if (!captcha?.settings || !captcha?.enabled || !captcha?.verify || !captcha?.publicSettings) {
      fail(503, '当前核心缺少评论验证码服务，请升级后再启用碎语评论。');
    }
    const config = captcha.settings(options);
    return {options, captcha, captchaConfig: config, public: {
      forceLogin: Boolean(options.comment?.forceLogin),
      captcha: captcha.enabled(config, 'comment') ? captcha.publicSettings(config) : null
    }};
  }

  async list(id, page = 1) {
    const target = await this.target(id);
    page = Math.min(100000, Math.max(1, Number.parseInt(page, 10) || 1));
    const where = {post_id: target.id, url: `/says/${target.id}`, status: 'approved'};
    const total = Number(await this.getModel('comment').where(where).count());
    const rows = await this.getModel('comment').where(where).order('id ASC').limit((page - 1) * 20, 20).select();
    // Recheck visibility after database reads, and never expose mail/IP/UA/user IDs or waiting comments.
    await this.target(id);
    return {page, total, pageSize: 20, items: rows.map(row => ({id: Number(row.id),
      nick: String(row.nick || '访客'), comment: String(row.comment || ''), createdAt: row.created_at}))};
  }

  async submit(id, body, request) {
    const origin = request.get('origin');
    if (!origin || origin !== `${request.protocol}://${request.host}`) fail(403, '请从本站页面提交评论。');
    if (!request.is('application/json')) fail(415, '评论需要 JSON 请求。');
    const key = request.ip || 'unknown';
    if (this.pending.has(key)) fail(429, '评论提交中，请勿重复发送。');
    this.pending.set(key, true);
    try { return await this.create(id, body || {}, request) } finally { this.pending.delete(key) }
  }

  async create(id, body, request) {
    const item = await this.target(id, true);
    const path = `/says/${item.id}`;
    const {options, captcha, captchaConfig} = await this.configuration();
    const host = this.getService('comment');
    if (!host?.create || !host?.context || !host?.validateCommentInput) fail(503, '当前核心缺少兼容的评论服务。');
    // Use the host's authenticated comment identity, not an author ID supplied by the client.
    request.state.jwtSecret ||= options.jwt_secret || options.comment_jwt_secret;
    const controller = {ctx: request, model: this.getModel, service: this.getService,
      get: name => request.query?.[name]};
    const runtime = await host.create(controller);
    const context = await host.context(controller, runtime.users, runtime.core, runtime.tokenService, runtime.avatarService);
    const user = context.state.userInfo;
    const config = options.comment || {};
    if (!user && config.forceLogin) fail(401, '请先登录博客账号再评论。');
    const data = {};
    for (const field of ['comment', 'nick', 'mail', 'link', 'captcha']) {
      if (body[field] !== undefined && typeof body[field] !== 'string') fail(400, '评论字段格式不正确。');
      data[field] = String(body[field] || '').trim();
    }
    if (!data.comment || data.comment.length > 5000 || data.nick.length > 80 || data.mail.length > 255 ||
        data.link.length > 512 || data.captcha.length > 8192 || body.pid || body.rid) fail(400, '请填写有效的评论，正文最多 5000 字，暂不支持楼中楼回复。');
    if (user) {
      data.nick = String(user.display_name || user.nick || '用户').slice(0, 80);
      data.mail = String(user.email || '').slice(0, 255);
    } else if (!data.nick) fail(400, '请填写昵称。');
    if (data.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.mail)) fail(400, '邮箱格式不正确。');
    if (data.link) {
      let url;
      try { url = new URL(data.link) } catch { fail(400, '网站地址格式不正确。') }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(400, '网站地址需要 HTTP 或 HTTPS。');
    }
    try { host.validateCommentInput(data, context, config) } catch { fail(400, '评论不符合站点的字数或必填信息要求。') }
    if (strings(config.disallowIPList).includes(request.ip)) fail(403, '当前地址不允许评论。');
    if (!user && !await captcha.verify(captchaConfig, data.captcha, request.ip, 'comment')) fail(403, '验证码校验失败，请刷新页面后重试。');
    const model = () => this.getModel('comment');
    const interval = Math.max(10, Number(config.ipQps) || 60);
    const since = this.now(new Date(Date.now() - interval * 1000));
    if (Number(await model().where({ip: request.ip || '', inserted_at: ['>', since]}).count())) fail(429, '评论过于频繁，请稍后再试。');
    if (Number(await model().where({post_id: item.id, comment: data.comment, nick: data.nick, mail: data.mail}).count())) {
      fail(409, '这条评论已提交，请勿重复发送。');
    }
    await this.target(id, true);
    const timestamp = this.now();
    const spam = strings(config.forbiddenWords).some(word => data.comment.toLowerCase().includes(word.toLowerCase()));
    const saved = await model().add({post_id: item.id, url: path, comment: data.comment,
      nick: data.nick, mail: data.mail, link: data.link, user_id: user ? String(user.objectId) : null,
      ip: String(request.ip || '').slice(0, 64), ua: String(request.get('user-agent') || '').slice(0, 1024),
      status: spam ? 'spam' : 'waiting', sticky: 0, like: 0, pid: null, rid: null,
      inserted_at: timestamp, created_at: timestamp, updated_at: timestamp});
    // A target removed or hidden during submission must not retain a newly submitted comment.
    try { await this.target(id, true) } catch (error) {
      await model().where({id: Number(saved), post_id: item.id}).delete();
      throw error;
    }
    return {message: '评论已提交，审核通过后会显示。'};
  }

  async handle(operation, request) {
    request.set?.('Cache-Control', 'no-store');
    try { return {success: true, data: await operation()} } catch (error) {
      const known = error.publicCommentError || error.status === 404;
      request.status = known ? error.status : 503;
      if (!known) this.logger?.error?.('say: comment operation failed; inspect database and host comment-service compatibility.');
      return {success: false, message: known ? (error.status === 404 ? '碎语或评论不存在。' : error.message)
        : '评论服务暂时不可用，请先刷新页面核对结果，勿立即重发。'};
    }
  }
}

module.exports = {SayComments};
