'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {parse, platforms} = require('./lib/adapters');
const {CommentImporter} = require('./lib/importer');

function importer() {
  return new CommentImporter({
    getModel: name => think.model(name),
    now: () => new Date()
  });
}

function request(body, config) {
  body = body && typeof body === 'object' ? body : {};
  const platform = String(body.platform || '').toLowerCase();
  if (!platforms.includes(platform)) throw Object.assign(new Error('不支持的评论系统'), {status: 400});
  if (body.source === undefined || body.source === null) throw Object.assign(new Error('请选择或粘贴导出文件'), {status: 400});
  const serialized = typeof body.source === 'string' ? body.source : JSON.stringify(body.source);
  const limit = Math.max(Number(config.maxSourceBytes) || 20 * 1024 * 1024, 1024);
  if (Buffer.byteLength(serialized) > limit) throw Object.assign(new Error(`导出文件不能超过 ${Math.ceil(limit / 1024 / 1024)} MiB`), {status: 413});
  let urlMap = {};
  if (body.urlMap && typeof body.urlMap === 'object' && !Array.isArray(body.urlMap)) urlMap = body.urlMap;
  return {comments: parse(platform, body.source), options: {urlMap, status: body.status}};
}

function fail(ctx, error) {
  const known = {
    EMPTY_SOURCE: '导出文件为空',
    INVALID_JSON: '无法解析 JSON，请确认导出格式',
    UNSUPPORTED_PLATFORM: '不支持的评论系统'
  };
  ctx.throw(error.status || 400, known[error.message] || error.message || '导入失败');
}

module.exports = {
  register(context) {
    const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    context.routes.register({
      method: 'GET',
      path: '/ui',
      auth: 'admin',
      handler({ctx}) {
        ctx.type = 'text/html; charset=utf-8';
        const jwt = ctx.cookie('thinkjs');
        const csrf = crypto.createHmac('sha256', ctx.state.jwtSecret).update(`plugin-csrf:${jwt}`).digest('base64url');
        return html.replace('"__CSRF_TOKEN__"', JSON.stringify(csrf));
      }
    });

    context.routes.register({
      method: 'POST',
      path: '/preview',
      auth: 'admin',
      async handler({ctx, body}) {
        try {
          const input = request(body, context.config);
          const result = await importer().preview(input.comments, input.options);
          delete result.resolved;
          return {errno: 0, data: result};
        } catch (error) {
          context.logger.warn?.(`[comment-import] preview failed: ${error.message}`);
          return fail(ctx, error);
        }
      }
    });

    context.routes.register({
      method: 'POST',
      path: '/import',
      auth: 'admin',
      async handler({ctx, body}) {
        try {
          const input = request(body, context.config);
          const result = await importer().run(input.comments, input.options);
          context.logger.info?.(`[comment-import] imported ${result.imported}, skipped ${result.duplicates} duplicates`);
          return {errno: 0, data: result};
        } catch (error) {
          context.logger.error?.(`[comment-import] import failed: ${error.stack || error.message}`);
          return fail(ctx, error);
        }
      }
    });
  },

  activate(context) {
    context.logger.info?.('[comment-import] available at /api/plugins/comment-import/ui');
  }
};

module.exports._test = {request};
