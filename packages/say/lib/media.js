'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'], ['image/webp', '.webp'],
  ['audio/mpeg', '.mp3'], ['audio/amr', '.amr'], ['audio/amr-wb', '.amr'], ['application/octet-stream', '']
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

async function uploadBuffer(buffer, {filename, mime}, dependencies = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) {
    throw Object.assign(new Error('Media must be between 1 byte and 20 MB'), {status: 400});
  }
  mime = String(mime || 'application/octet-stream').split(';')[0].toLowerCase();
  if (!ALLOWED.has(mime)) throw Object.assign(new Error(`Unsupported media type: ${mime}`), {status: 400});
  const detected = detectedType(buffer);
  const extensionType = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
    ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.mp3', 'audio/mpeg'], ['.amr', 'audio/amr']])
    .get(path.extname(String(filename || '')).toLowerCase());
  if (!detected || (mime !== 'application/octet-stream' && detected !== mime) ||
      (mime === 'application/octet-stream' && extensionType && !detected.startsWith(extensionType.split('/')[0] + '/'))) {
    throw Object.assign(new Error('Media content does not match its declared type'), {status: 400});
  }
  if (mime === 'application/octet-stream') mime = detected;
  const options = dependencies.getOptions ? await dependencies.getOptions() : await think.model('options').getOptions();
  const config = options && options.upload;
  if (!config || !config.type) throw new Error('Firekylin upload provider is not configured');
  const expectedExtension = ALLOWED.get(mime);
  const suppliedName = cleanName(filename, `say-media${expectedExtension}`);
  const suppliedExtension = path.extname(suppliedName).toLowerCase();
  const extension = suppliedExtension && extensionType === mime ? suppliedExtension : expectedExtension;
  const name = suppliedExtension && suppliedExtension !== extension
    ? `${path.basename(suppliedName, suppliedExtension)}${extension}` : suppliedName;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'firekylin-say-'));
  const localPath = path.join(temporary, `${Date.now()}-${name}`);
  try {
    await fs.writeFile(localPath, buffer, {flag: 'wx', mode: 0o600});
    const file = {name, path: localPath, size: buffer.length, type: mime};
    const uploadConfig = {...config, name: path.parse(name).name, file};
    const sdk = ['r2', 'minio', 'backblaze', 'wasabi', 'digitalocean', 'vercel'].includes(config.type);
    const uploader = dependencies.getUploader
      ? dependencies.getUploader(sdk ? 'files-sdk' : config.type)
      : think.service(`upload/${sdk ? 'files-sdk' : config.type}`);
    return await uploader.run(localPath, uploadConfig);
  } finally {
    await fs.rm(temporary, {recursive: true, force: true});
  }
}

async function uploadBase64(value, options, dependencies) {
  const decoded = decodeBase64Media(value);
  if (!decoded) return '';
  const mime = decoded.mime || options.mime || 'application/octet-stream';
  return uploadBuffer(decoded.buffer, {filename: options.filename, mime}, dependencies);
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

module.exports = {ALLOWED, MAX_BYTES, decodeBase64Media, detectedType, downloadWecomMedia, uploadBase64, uploadBuffer, wecomAccessToken};
