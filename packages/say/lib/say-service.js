'use strict';

const crypto = require('node:crypto');

const OPTION_KEY = 'plugin_say_settings';
const SAY_TYPE = 3;
const KINDS = new Set(['text', 'image', 'textpic', 'voice', 'location', 'link', 'music']);
const STATUSES = new Set(['public', 'private', 'hidden']);
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  pageSize: 10,
  apiKey: '',
  authorId: 1,
  amapKey: '',
  wecomCorpId: '',
  wecomCorpSecret: '',
  wecomToken: '',
  wecomEncodingAESKey: '',
  wechatAppId: '',
  wechatAppSecret: '',
  wechatToken: '',
  wechatEncodingAESKey: '',
  wechatAllowedOpenIds: '',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuVerificationToken: '',
  feishuEncryptKey: '',
  feishuAllowedOpenIds: ''
});

function parse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback } catch { return fallback }
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeSettings(value = {}, previous = {}) {
  const prior = {...DEFAULT_SETTINGS, ...previous};
  if (typeof value.apiKey === 'string' && value.apiKey && value.apiKey.length < 16) {
    throw Object.assign(new Error('API key must be at least 16 characters'), {status: 400});
  }
  if (typeof value.wecomEncodingAESKey === 'string' && value.wecomEncodingAESKey &&
      !/^[A-Za-z0-9+/]{43}$/.test(value.wecomEncodingAESKey)) {
    throw Object.assign(new Error('WeCom EncodingAESKey must be 43 characters'), {status: 400});
  }
  if (typeof value.wechatEncodingAESKey === 'string' && value.wechatEncodingAESKey &&
      !/^[A-Za-z0-9+/]{43}$/.test(value.wechatEncodingAESKey)) {
    throw Object.assign(new Error('WeChat EncodingAESKey must be 43 characters'), {status: 400});
  }
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : prior.enabled,
    pageSize: integer(value.pageSize, prior.pageSize, 1, 100),
    apiKey: typeof value.apiKey === 'string' && value.apiKey ? value.apiKey.slice(0, 256) : prior.apiKey,
    authorId: integer(value.authorId, prior.authorId, 1, Number.MAX_SAFE_INTEGER),
    amapKey: typeof value.amapKey === 'string' ? value.amapKey.trim().slice(0, 256) : prior.amapKey,
    wecomCorpId: typeof value.wecomCorpId === 'string' ? value.wecomCorpId.trim().slice(0, 128) : prior.wecomCorpId,
    wecomCorpSecret: typeof value.wecomCorpSecret === 'string' && value.wecomCorpSecret
      ? value.wecomCorpSecret.trim().slice(0, 256) : prior.wecomCorpSecret,
    wecomToken: typeof value.wecomToken === 'string' && value.wecomToken
      ? value.wecomToken.trim().slice(0, 256) : prior.wecomToken,
    wecomEncodingAESKey: typeof value.wecomEncodingAESKey === 'string' && value.wecomEncodingAESKey
      ? value.wecomEncodingAESKey.trim().slice(0, 256) : prior.wecomEncodingAESKey,
    wechatAppId: typeof value.wechatAppId === 'string' ? value.wechatAppId.trim().slice(0, 128) : prior.wechatAppId,
    wechatAppSecret: typeof value.wechatAppSecret === 'string' && value.wechatAppSecret
      ? value.wechatAppSecret.trim().slice(0, 256) : prior.wechatAppSecret,
    wechatToken: typeof value.wechatToken === 'string' && value.wechatToken
      ? value.wechatToken.trim().slice(0, 256) : prior.wechatToken,
    wechatEncodingAESKey: typeof value.wechatEncodingAESKey === 'string' && value.wechatEncodingAESKey
      ? value.wechatEncodingAESKey.trim().slice(0, 256) : prior.wechatEncodingAESKey,
    wechatAllowedOpenIds: typeof value.wechatAllowedOpenIds === 'string'
      ? [...new Set(strings(value.wechatAllowedOpenIds))].join('\n') : prior.wechatAllowedOpenIds,
    feishuAppId: typeof value.feishuAppId === 'string' ? value.feishuAppId.trim().slice(0, 128) : prior.feishuAppId,
    feishuAppSecret: typeof value.feishuAppSecret === 'string' && value.feishuAppSecret
      ? value.feishuAppSecret.trim().slice(0, 256) : prior.feishuAppSecret,
    feishuVerificationToken: typeof value.feishuVerificationToken === 'string' && value.feishuVerificationToken
      ? value.feishuVerificationToken.trim().slice(0, 256) : prior.feishuVerificationToken,
    feishuEncryptKey: typeof value.feishuEncryptKey === 'string' && value.feishuEncryptKey
      ? value.feishuEncryptKey.trim().slice(0, 256) : prior.feishuEncryptKey,
    feishuAllowedOpenIds: typeof value.feishuAllowedOpenIds === 'string'
      ? [...new Set(strings(value.feishuAllowedOpenIds))].join('\n') : prior.feishuAllowedOpenIds
  };
}

function strings(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    const parsed = parse(value, null);
    if (Array.isArray(parsed)) return strings(parsed);
  }
  return String(value).split(/[\n,]/).map(item => item.trim()).filter(Boolean);
}

function tags(value, text = '') {
  const found = [...String(text).matchAll(/(?:^|\s)#([^\s#]+)/g)].map(match => match[1]);
  return [...new Set([...strings(value).map(item => item.replace(/^#/, '')), ...found]
    .map(item => item.trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
}

function safeUrl(value, label) {
  const source = String(value || '').trim();
  if (!source) return '';
  let url;
  try { url = new URL(source) } catch { throw Object.assign(new Error(`${label} must be a valid URL`), {status: 400}) }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error(`${label} must use HTTP or HTTPS`), {status: 400});
  }
  return source.slice(0, 2048);
}

function normalize(input = {}) {
  const kind = typeof input.kind === 'undefined' || input.kind === null ? 'text' : input.kind;
  const status = typeof input.status === 'undefined' || input.status === null ? 'public' : input.status;
  if (!KINDS.has(kind)) throw Object.assign(new Error('Invalid say kind'), {status: 400});
  if (!STATUSES.has(status)) throw Object.assign(new Error('Invalid say status'), {status: 400});
  const text = String(input.text || '').trim().slice(0, 20000);
  const data = {kind, status, text, tags: tags(input.tags, text), source: String(input.source || 'Firekylin').slice(0, 80)};
  if (['image', 'textpic'].includes(kind)) {
    data.images = strings(input.images).slice(0, 20).map((item, index) => safeUrl(item, `Image ${index + 1}`));
    if (!data.images.length) throw Object.assign(new Error('At least one image URL is required'), {status: 400});
  }
  if (kind === 'voice') data.mediaUrl = safeUrl(input.mediaUrl, 'Voice URL');
  if (kind === 'location') {
    if (input.latitude === '' || input.latitude === null || typeof input.latitude === 'undefined' ||
        input.longitude === '' || input.longitude === null || typeof input.longitude === 'undefined') {
      throw Object.assign(new Error('Valid latitude and longitude are required'), {status: 400});
    }
    data.latitude = Number(input.latitude);
    data.longitude = Number(input.longitude);
    data.label = String(input.label || '').trim().slice(0, 500);
    if (!Number.isFinite(data.latitude) || data.latitude < -90 || data.latitude > 90 ||
        !Number.isFinite(data.longitude) || data.longitude < -180 || data.longitude > 180) {
      throw Object.assign(new Error('Valid latitude and longitude are required'), {status: 400});
    }
  }
  if (kind === 'link') {
    data.url = safeUrl(input.url, 'Link URL');
    data.title = String(input.title || '').trim().slice(0, 300);
    data.description = String(input.description || '').trim().slice(0, 1000);
    data.cover = input.cover ? safeUrl(input.cover, 'Cover URL') : '';
  }
  if (kind === 'music') {
    data.url = safeUrl(input.url, 'Music URL');
    data.title = String(input.title || '').trim().slice(0, 300);
    data.artist = String(input.artist || '').trim().slice(0, 300);
    data.cover = input.cover ? safeUrl(input.cover, 'Cover URL') : '';
  }
  if (!text && kind === 'text') throw Object.assign(new Error('Say content is required'), {status: 400});
  if (kind === 'voice' && !data.mediaUrl) throw Object.assign(new Error('Voice URL is required'), {status: 400});
  if (['link', 'music'].includes(kind) && !data.url) throw Object.assign(new Error('URL is required'), {status: 400});
  return data;
}

function databaseStatus(status) {
  if (status === 'public') return {status: 3, is_public: 1};
  if (status === 'private') return {status: 3, is_public: 0};
  return {status: 0, is_public: 0};
}

function displayStatus(row) {
  if (Number(row.status) !== 3) return 'hidden';
  return Number(row.is_public) === 1 ? 'public' : 'private';
}

function decode(row) {
  let options = parse(row.options);
  if (typeof options === 'string') options = parse(options);
  const data = options.say || {};
  return {
    id: Number(row.id),
    kind: data.kind || 'text',
    status: displayStatus(row),
    text: data.text || row.markdown_content || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    source: data.source || 'Firekylin',
    images: data.images || [],
    mediaUrl: data.mediaUrl || '',
    latitude: data.latitude,
    longitude: data.longitude,
    label: data.label || '',
    url: data.url || '',
    title: data.title || '',
    description: data.description || '',
    artist: data.artist || '',
    cover: data.cover || '',
    createdAt: row.create_time,
    updatedAt: row.update_time
  };
}

function secureEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function mergeData(items) {
  const mergeableKinds = new Set(['text', 'image', 'textpic', 'location', 'voice']);
  if (items.some(item => !mergeableKinds.has(item.kind))) {
    throw Object.assign(new Error('Selected says contain an unsupported merge type'), {status: 400});
  }
  const byKind = kind => items.filter(item => item.kind === kind);
  const texts = byKind('text');
  const images = byKind('image');
  const textpics = byKind('textpic');
  const locations = byKind('location');
  const voices = byKind('voice');
  let merged;
  if (texts.length === 1 && textpics.length === 0 && images.length >= 1 && locations.length === 0 && voices.length === 0) {
    merged = {...texts[0], kind: 'textpic', images: images.flatMap(item => item.images)};
  } else if (texts.length === 0 && textpics.length === 1 && images.length >= 1 && locations.length === 0 && voices.length === 0) {
    merged = {...textpics[0], images: [...textpics[0].images, ...images.flatMap(item => item.images)]};
  } else if (texts.length === 0 && textpics.length === 0 && images.length >= 2 && locations.length === 0 && voices.length === 0) {
    merged = {...images[0], images: images.flatMap(item => item.images)};
  } else if (texts.length === 1 && locations.length === 1 && images.length === 0 && textpics.length === 0 && voices.length === 0) {
    merged = {...locations[0], text: texts[0].text};
  } else if (texts.length === 1 && voices.length === 1 && images.length === 0 && textpics.length === 0 && locations.length === 0) {
    merged = {...voices[0], text: texts[0].text};
  } else {
    throw Object.assign(new Error('Selected says do not match a supported merge rule'), {status: 400});
  }
  merged.tags = [...new Set(items.flatMap(item => item.tags || []))];
  return merged;
}

class SayService {
  constructor({getModel, now}) {
    this.getModel = getModel;
    this.now = now;
  }

  async settings() {
    const row = await this.getModel('options').where({key: OPTION_KEY}).find();
    return normalizeSettings(parse(row && row.value));
  }

  async saveSettings(value) {
    const settings = normalizeSettings(value, await this.settings());
    await this.getModel('options').updateOptions(OPTION_KEY, JSON.stringify(settings));
    return settings;
  }

  model() { return this.getModel('post') }

  async create(input, authorId) {
    const data = normalize(input);
    const now = this.now();
    const visibility = databaseStatus(data.status);
    const token = crypto.randomBytes(6).toString('hex');
    const options = JSON.stringify({say: data});
    const row = {
      user_id: integer(authorId, 1, 1, Number.MAX_SAFE_INTEGER),
      type: SAY_TYPE,
      ...visibility,
      title: data.kind,
      pathname: `say-${Date.now()}-${token}`,
      summary: data.text.slice(0, 200),
      markdown_content: data.text,
      content: data.text,
      allow_comment: 0,
      create_time: now,
      update_time: now,
      comment_num: 0,
      options
    };
    const id = await this.model().addPost(row);
    return {...data, id: Number(id && id.id || id), createdAt: now, updatedAt: now};
  }

  async get(id) {
    id = integer(id, 0, 1, Number.MAX_SAFE_INTEGER);
    if (!id) throw Object.assign(new Error('Valid say ID is required'), {status: 400});
    const row = await this.model().setRelation(false).where({type: SAY_TYPE, id}).find();
    if (!row || !row.id) throw Object.assign(new Error('Say was not found'), {status: 404});
    return decode(row);
  }

  async update(id, input) {
    const current = await this.get(id);
    const data = normalize({...current, ...input});
    const visibility = databaseStatus(data.status);
    await this.model().savePost({id: current.id, ...visibility, title: data.kind,
      summary: data.text.slice(0, 200), markdown_content: data.text, content: data.text,
      update_time: this.now(), options: JSON.stringify({say: data})});
    return this.get(current.id);
  }

  async duplicate(id, authorId) {
    const current = await this.get(id);
    const copy = {...current};
    delete copy.id;
    delete copy.createdAt;
    delete copy.updatedAt;
    return this.create(copy, authorId);
  }

  async all() {
    return (await this.model().setRelation(false).where({type: SAY_TYPE})
      .order('create_time DESC').select()).map(decode);
  }

  async list({page = 1, pageSize, tag, status, keyword, publicOnly = false} = {}) {
    const settings = await this.settings();
    page = integer(page, 1, 1, 100000);
    pageSize = integer(pageSize, settings.pageSize, 1, 100);
    const query = String(keyword || '').trim().toLowerCase();
    let items = await this.all();
    if (publicOnly) items = settings.enabled ? items.filter(item => item.status === 'public') : [];
    if (STATUSES.has(status)) items = items.filter(item => item.status === status);
    if (tag) items = items.filter(item => item.tags.includes(String(tag)));
    if (query) items = items.filter(item => [item.text, item.title, item.description, item.artist]
      .some(value => String(value || '').toLowerCase().includes(query)));
    const total = items.length;
    return {page, pageSize, total, items: items.slice((page - 1) * pageSize, page * pageSize)};
  }

  async updateStatus(ids, status) {
    if (!STATUSES.has(status)) throw Object.assign(new Error('Invalid status'), {status: 400});
    const normalizedIds = strings(ids).map(Number).filter(Number.isSafeInteger);
    if (!normalizedIds.length) throw Object.assign(new Error('At least one say ID is required'), {status: 400});
    return this.model().where({type: SAY_TYPE, id: ['IN', normalizedIds]}).update(databaseStatus(status));
  }

  async remove(ids) {
    const normalizedIds = strings(ids).map(Number).filter(Number.isSafeInteger);
    if (!normalizedIds.length) throw Object.assign(new Error('At least one say ID is required'), {status: 400});
    const rows = await this.model().setRelation(false).where({type: SAY_TYPE, id: ['IN', normalizedIds]}).select();
    let deleted = 0;
    for (const row of rows) deleted += Number(await this.model().deletePost(row.id) || 0);
    return deleted;
  }

  async merge(ids) {
    const normalizedIds = [...new Set(strings(ids).map(Number).filter(Number.isSafeInteger))];
    if (normalizedIds.length < 2) throw Object.assign(new Error('At least two say IDs are required'), {status: 400});
    const rows = await this.model().setRelation(false).where({type: SAY_TYPE, id: ['IN', normalizedIds]})
      .order('create_time ASC').select();
    if (rows.length !== normalizedIds.length) throw Object.assign(new Error('One or more says were not found'), {status: 404});
    const merged = mergeData(rows.map(decode));
    const keep = rows[0];
    const visibility = databaseStatus(merged.status);
    await this.model().savePost({id: keep.id, ...visibility, title: merged.kind, summary: merged.text.slice(0, 200),
      markdown_content: merged.text, content: merged.text, options: JSON.stringify({say: merged})});
    for (const row of rows.slice(1)) await this.model().deletePost(row.id);
    return {...merged, id: Number(keep.id), createdAt: keep.create_time};
  }

  async manage({operation, ids, status}) {
    if (operation === 'delete') return {message: `已删除 ${await this.remove(ids)} 条碎语。`};
    if (operation === 'status') {
      await this.updateStatus(ids, status);
      return {message: '碎语状态已更新。'};
    }
    if (operation === 'merge') {
      const item = await this.merge(ids);
      return {message: `碎语已合并为 #${item.id}。`, item};
    }
    throw Object.assign(new Error('Unsupported operation'), {status: 400});
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  KINDS,
  OPTION_KEY,
  SAY_TYPE,
  SayService,
  decode,
  mergeData,
  normalize,
  normalizeSettings,
  secureEqual,
  strings,
  tags
};
