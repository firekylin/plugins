'use strict';

const MAX_BYTES = 20 * 1024 * 1024;
const API = 'https://api.bot.qq.com';
const SANDBOX = 'https://sandbox.api.sgroup.qq.com';

function qqError(code = 'QQ_API_FAILED', status) {
  return Object.assign(new Error('QQ request failed'), {code, httpStatus: status});
}

async function readBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw qqError('MEDIA_SIZE_INVALID');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) throw qqError('MEDIA_SIZE_INVALID');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function mediaUrl(value) {
  const url = new URL(value);
  const hosts = ['nt.qq.com', 'nt.qq.com.cn', 'grouppro.qq.com'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
    throw qqError('QQ_MEDIA_URL_DENIED');
  }
  return url;
}

function gatewayUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'wss:' || url.username || url.password || url.port ||
      !['api.bot.qq.com', 'api.sgroup.qq.com', 'sandbox.api.sgroup.qq.com'].includes(url.hostname)) {
    throw qqError('QQ_GATEWAY_DENIED');
  }
  return url.href;
}

function createQqApi(settings, {fetchImpl = global.fetch, now = Date.now} = {}) {
  let cached;
  let tokenPending;
  const base = settings.qqSandbox ? SANDBOX : API;
  async function json(url, options = {}) {
    const response = await fetchImpl(url, {...options, redirect: 'error', signal: AbortSignal.timeout(10000)});
    const bytes = await readBytes(response, 1024 * 1024);
    let data;
    try { data = JSON.parse(bytes.toString()) } catch { throw qqError('QQ_API_FAILED', response.status) }
    if (!response.ok || data.code) {
      if (data.code === 40054005) return {duplicate: true};
      const error = qqError('QQ_API_FAILED', response.status);
      if (Number.isSafeInteger(data.code)) error.qqCode = data.code;
      throw error;
    }
    return data;
  }
  async function token() {
    if (cached && cached.expires > now() + 60000) return cached.value;
    if (!tokenPending) tokenPending = (async() => {
      const data = await json(`${API}/app/getAppAccessToken`, {method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({appId: settings.qqAppId, clientSecret: settings.qqAppSecret})});
      if (typeof data.access_token !== 'string' || !data.access_token || !(Number(data.expires_in) > 0)) {
        throw qqError('QQ_TOKEN_INVALID');
      }
      cached = {value: data.access_token, expires: now() + Number(data.expires_in) * 1000};
      return cached.value;
    })().finally(() => { tokenPending = null });
    return tokenPending;
  }
  async function call(path, body) {
    const access = await token();
    try {
      return await json(base + path, {method: body ? 'POST' : 'GET',
        headers: {Authorization: `QQBot ${access}`, 'Content-Type': 'application/json'},
        ...(body ? {body: JSON.stringify(body)} : {})});
    } catch (error) {
      if (error.httpStatus === 401) cached = null;
      throw error; // Never retry a reply automatically after an uncertain outcome.
    }
  }
  return {
    token,
    async gateway() { return gatewayUrl((await call('/gateway')).url) },
    reply(openId, messageId, text, sequence = 1) {
      return call(`/v2/users/${encodeURIComponent(openId)}/messages`,
        {content: text, msg_type: 0, msg_id: messageId, msg_seq: sequence});
    },
    async download(attachment) {
      const convertedVoice = attachment.content_type === 'voice' && attachment.voice_wav_url;
      const url = mediaUrl(convertedVoice || attachment.url);
      const response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw qqError('QQ_DOWNLOAD_FAILED', response.status);
      const buffer = await readBytes(response, MAX_BYTES);
      return {buffer, filename: convertedVoice ? 'qq-voice.wav' : attachment.filename || 'qq-media',
        mime: convertedVoice ? 'audio/wav' : attachment.content_type === 'voice' ? 'application/octet-stream' : attachment.content_type || response.headers.get('content-type') || 'application/octet-stream'};
    }
  };
}

module.exports = {createQqApi, gatewayUrl, mediaUrl, readBytes};
