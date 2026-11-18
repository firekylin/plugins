'use strict';

const path = require('node:path');

const MAX_BYTES = 20 * 1024 * 1024;
const wechatTokens = new Map();
const feishuTokens = new Map();
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'], ['image/webp', '.webp'],
  ['audio/mpeg', '.mp3'], ['audio/amr', '.amr'], ['audio/amr-wb', '.amr'], ['audio/ogg', '.ogg'],
  ['application/octet-stream', '']
]);

function cleanName(value, fallback = 'say-media') {
  const name = path.basename(String(value || fallback)).replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120);
  return name || fallback;
}

function detectedType(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString() === 'ID3') return 'audio/mpeg';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString() === '#!AMR\n') return 'audio/amr';
  if (buffer.length >= 9 && buffer.subarray(0, 9).toString() === '#!AMR-WB\n') return 'audio/amr-wb';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  return '';
}

function decodeBase64Media(value) {
  if (!value) return null;
  let source = String(value);
  let mime = '';
  const data = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(source);
  if (data) [, mime, source] = data;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.replace(/\s/g, ''))) {
    throw Object.assign(new Error('Invalid base64 media'), {status: 400});
  }
  const buffer = Buffer.from(source, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw Object.assign(new Error('Media must be between 1 byte and 20 MB'), {status: 400});
  return {buffer, mime};
}

function validationError(message, code, buffer, mime) {
  return Object.assign(new Error(message), {
    status: 400,
    code,
    media: {
      mime,
      detected: Buffer.isBuffer(buffer) ? detectedType(buffer) || 'unknown' : 'unknown',
      bytes: Buffer.isBuffer(buffer) ? buffer.length : 0
    }
  });
}

async function uploadBuffer(buffer, {filename, mime, userId}, dependencies = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) {
    throw validationError('Media must be between 1 byte and 20 MB', 'MEDIA_SIZE_INVALID', buffer, mime);
  }
  mime = String(mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  mime = ({'audio/opus': 'audio/ogg', 'application/ogg': 'audio/ogg',
    'audio/x-ogg': 'audio/ogg', 'audio/mp3': 'audio/mpeg', 'audio/x-amr': 'audio/amr'})[mime] || mime;
  if (!ALLOWED.has(mime)) {
    throw validationError('Unsupported media type', 'MEDIA_TYPE_UNSUPPORTED', buffer, mime);
  }
  const detected = detectedType(buffer);
  const extensionType = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
    ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.mp3', 'audio/mpeg'], ['.amr', 'audio/amr'],
    ['.ogg', 'audio/ogg'], ['.opus', 'audio/ogg']])
    .get(path.extname(String(filename || '')).toLowerCase());
  if (!detected || (mime !== 'application/octet-stream' && detected !== mime) ||
      (mime === 'application/octet-stream' && extensionType && !detected.startsWith(extensionType.split('/')[0] + '/'))) {
    throw validationError('Media content does not match its declared type', 'MEDIA_TYPE_MISMATCH', buffer, mime);
  }
  if (mime === 'application/octet-stream') mime = detected;
  userId = Number(userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new TypeError('An explicit upload owner is required');
  const expectedExtension = ALLOWED.get(mime);
  const suppliedName = cleanName(filename, `say-media${expectedExtension}`);
  const suppliedExtension = path.extname(suppliedName).toLowerCase();
  const extension = suppliedExtension && extensionType === mime ? suppliedExtension : expectedExtension;
  const name = !suppliedExtension ? `${suppliedName}${extension}`
    : suppliedExtension !== extension ? `${path.basename(suppliedName, suppliedExtension)}${extension}` : suppliedName;
  if (dependencies.mediaUpload) {
    const result = await dependencies.mediaUpload({data: buffer, filename: name, mime, ownerId: userId});
    return result.url;
  }
  return require('./media-legacy').legacyUpload(buffer, {filename: name, mime, userId}, dependencies);
}

function createMediaClient(media) {
  if (media !== undefined && (!media || typeof media.upload !== 'function')) {
    throw new TypeError('Invalid host media API');
  }
  const dependencies = media ? {mediaUpload: media.upload.bind(media)} : {};
  return Object.freeze({
    uploadBuffer: (buffer, options) => uploadBuffer(buffer, options, dependencies),
    uploadBase64: (value, options) => uploadBase64(value, options, dependencies)
  });
}

async function uploadBase64(value, options, dependencies) {
  const decoded = decodeBase64Media(value);
  if (!decoded) return '';
  const mime = decoded.mime || options.mime || 'application/octet-stream';
  return uploadBuffer(decoded.buffer, {filename: options.filename, mime, userId: options.userId}, dependencies);
}

async function wecomAccessToken(settings, fetchImpl = global.fetch) {
  const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
  url.searchParams.set('corpid', settings.wecomCorpId);
  url.searchParams.set('corpsecret', settings.wecomCorpSecret);
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(5000)});
  const result = await response.json();
  if (!response.ok || result.errcode) throw new Error(`WeCom token error: ${result.errmsg || response.status}`);
  return result.access_token;
}

async function downloadWecomMedia(mediaId, settings, fetchImpl = global.fetch) {
  if (!/^[A-Za-z0-9_@.-]{1,512}$/.test(String(mediaId || ''))) throw new Error('Invalid WeCom media ID');
  const token = await wecomAccessToken(settings, fetchImpl);
  const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/media/get');
  url.searchParams.set('access_token', token);
  url.searchParams.set('media_id', mediaId);
  const response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`WeCom media download error: ${response.status}`);
  const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  if (mime === 'application/json' || mime === 'text/plain') {
    const result = await response.json();
    throw new Error(`WeCom media error: ${result.errmsg || result.errcode}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('WeCom media exceeds 20 MB');
  const disposition = response.headers.get('content-disposition') || '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || `wecom-${mediaId}${ALLOWED.get(mime) || ''}`;
  return {buffer, filename: cleanName(filename), mime};
}

async function wechatAccessToken(settings, fetchImpl = global.fetch, now = Date.now) {
  const cacheKey = `${settings.wechatAppId}:${settings.wechatAppSecret}`;
  const cached = wechatTokens.get(cacheKey);
  if (cached && cached.expiresAt > now() + 60000) return cached.value;
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', settings.wechatAppId);
  url.searchParams.set('secret', settings.wechatAppSecret);
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(5000)});
  const result = await response.json();
  if (!response.ok || result.errcode || !result.access_token) {
    throw new Error(`WeChat token error: ${result.errmsg || response.status}`);
  }
  wechatTokens.set(cacheKey, {value: result.access_token,
    expiresAt: now() + Math.max(0, Number(result.expires_in || 7200) - 120) * 1000});
  return result.access_token;
}

async function downloadWechatMedia(mediaId, settings, fetchImpl = global.fetch) {
  if (!/^[A-Za-z0-9_@.-]{1,512}$/.test(String(mediaId || ''))) throw new Error('Invalid WeChat media ID');
  const token = await wechatAccessToken(settings, fetchImpl);
  const url = new URL('https://api.weixin.qq.com/cgi-bin/media/get');
  url.searchParams.set('access_token', token);
  url.searchParams.set('media_id', mediaId);
  const response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`WeChat media download error: ${response.status}`);
  const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  if (mime === 'application/json' || mime === 'text/plain') {
    const result = await response.json();
    throw new Error(`WeChat media error: ${result.errmsg || result.errcode}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('WeChat media exceeds 20 MB');
  const disposition = response.headers.get('content-disposition') || '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || `wechat-${mediaId}${ALLOWED.get(mime) || ''}`;
  return {buffer, filename: cleanName(filename), mime};
}

async function downloadWechatImage(value, fetchImpl = global.fetch) {
  const url = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(url.protocol) ||
      !(url.hostname === 'qpic.cn' || url.hostname.endsWith('.qpic.cn'))) {
    throw new Error('Invalid WeChat image URL');
  }
  url.protocol = 'https:';
  const response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`WeChat image download error: ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_BYTES) throw new Error('WeChat image exceeds 20 MB');
  const mime = (response.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('WeChat image exceeds 20 MB');
  return {buffer, filename: `wechat-image-${Date.now()}${ALLOWED.get(mime) || '.jpg'}`, mime};
}

async function feishuAccessToken(settings, fetchImpl = global.fetch, now = Date.now) {
  const cacheKey = `${settings.feishuAppId}:${settings.feishuAppSecret}`;
  const cached = feishuTokens.get(cacheKey);
  if (cached && cached.expiresAt > now() + 60000) return cached.value;
  const response = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: {'Content-Type': 'application/json; charset=utf-8'},
    body: JSON.stringify({app_id: settings.feishuAppId, app_secret: settings.feishuAppSecret}),
    signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  if (!response.ok || result.code || !result.tenant_access_token) {
    throw Object.assign(new Error(`Feishu token error: ${result.msg || response.status}`),
      {feishuCode: result.code, httpStatus: response.status});
  }
  feishuTokens.set(cacheKey, {value: result.tenant_access_token,
    expiresAt: now() + Math.max(0, Number(result.expire || 7200) - 120) * 1000});
  return result.tenant_access_token;
}

async function downloadFeishuResource(messageId, fileKey, type, settings, fetchImpl = global.fetch) {
  if (!/^om_[A-Za-z0-9_-]{1,256}$/.test(String(messageId || '')) ||
      !/^[A-Za-z0-9_-]{1,512}$/.test(String(fileKey || '')) || !['image', 'file'].includes(type)) {
    throw new Error('Invalid Feishu message resource');
  }
  const token = await feishuAccessToken(settings, fetchImpl);
  const url = new URL(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}`);
  url.searchParams.set('type', type);
  const response = await fetchImpl(url, {headers: {Authorization: `Bearer ${token}`}, redirect: 'error',
    signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw Object.assign(new Error(`Feishu resource download error: ${response.status}`),
    {httpStatus: response.status});
  let mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  if (mime === 'application/json') {
    const result = await response.json();
    throw Object.assign(new Error(`Feishu resource error: ${result.msg || result.code}`),
      {feishuCode: result.code, httpStatus: response.status});
  }
  if (mime === 'audio/opus') mime = 'audio/ogg';
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_BYTES) throw new Error('Feishu resource exceeds 20 MB');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('Feishu resource exceeds 20 MB');
  const disposition = response.headers.get('content-disposition') || '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || `feishu-${fileKey}${ALLOWED.get(mime) || ''}`;
  return {buffer, filename: cleanName(filename), mime};
}

module.exports = {ALLOWED, MAX_BYTES, createMediaClient, decodeBase64Media, detectedType, downloadFeishuResource, downloadWechatImage,
  downloadWechatMedia, downloadWecomMedia, feishuAccessToken, uploadBase64, uploadBuffer, wechatAccessToken,
  wecomAccessToken};
