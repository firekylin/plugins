'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {SAY_TYPE} = require('./say-service');
const {escapeHtml} = require('./render');

function hostComments() {
  try { return require('firekylin/src/service/comment') } catch { return null }
}

function supportsNative(host = hostComments()) {
  const target = host?.pathnameFromUrl?.('/path?pathname=probe&type=3');
  return target?.pathname === 'probe' && target.type === SAY_TYPE;
}

function decodeAttribute(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

class NativeComments {
  constructor({comments, getModel, getService, host = hostComments()}) {
    this.comments = comments;
    this.getModel = getModel;
    this.getService = getService;
    this.host = host;
  }

  supported() { return supportsNative(this.host) }

  async configuration(id, request) {
    const item = await this.comments.target(id);
    if (!this.supported()) return {native: false, detailUrl: `/says/${item.id}`};
    if (!item.pathname) throw new Error('Missing comment pathname');
    // Reuse the host renderer's public configuration, including captcha and site preferences.
    // Never send the options model (which contains private keys) to the browser.
    const options = await this.getModel('options').getOptions(true);
    const html = this.getService('comment-render').render({
      archive: {stack: [{allow_comment: 1, status: 3, is_public: 1}]},
      options: {...options, siteUrl: options.site_url}, ctx: request, get: () => false
    }, {title: ''});
    const match = html.match(/data-comment-config="([^"]+)"/);
    if (!match) throw new Error('Unsupported native comment renderer');
    const config = JSON.parse(decodeAttribute(match[1]));
    config.serverURL = '/api/comment';
    const target = `/path?pathname=${encodeURIComponent(item.pathname)}&type=${SAY_TYPE}`;
    // Waline normalizes its path with decodeURI before sending it to the API.
    config.path = encodeURI(target);
    return {native: true, config, target};
  }

  async beforeCreate(data) {
    if (!this.supported()) return data;
    const options = await this.getModel('options').getOptions();
    const id = await this.host.resolveCommentPostId({model: this.getModel}, data.url, options);
    if (!id) return data;
    const row = await this.getModel('post').where({id}).field('id,type').find();
    if (Number(row.type) !== SAY_TYPE) return data;
    // Check all native URL aliases, not just our explicit /path identifier.
    await this.comments.target(id, true);
    return {...data, status: data.status === 'spam' ? 'spam' : 'waiting'};
  }
}

function renderNativeComments(id) {
  return `<section class="say-item"><div data-say-comments="${Number(id)}"></div></section>` +
    '<script defer src="/api/plugins/say/comment-client.js"></script>';
}

function clientScript() { return fs.readFileSync(path.join(__dirname, 'comment-client.js'), 'utf8') }

module.exports = {NativeComments, supportsNative, renderNativeComments, clientScript};
