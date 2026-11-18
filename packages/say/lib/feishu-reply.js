'use strict';

const crypto = require('node:crypto');
const {feishuAccessToken} = require('./media');

async function reply(messageId, text, eventKey, settings, fetchImpl = global.fetch) {
  if (!/^om_[A-Za-z0-9_-]{1,256}$/.test(String(messageId || ''))) throw new Error('Invalid Feishu message resource');
  if (!settings.feishuAppSecret) throw new Error('Feishu App Secret is not configured');
  const token = await feishuAccessToken(settings, fetchImpl);
  const uuid = crypto.createHash('sha256').update(`${eventKey}:${text}`).digest('hex').slice(0, 40);
  const response = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8'},
    body: JSON.stringify({msg_type: 'text', content: JSON.stringify({text}), uuid})
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    const error = new Error('Feishu reply request failed');
    if (Number.isSafeInteger(result.code) && result.code !== 0) error.feishuCode = result.code;
    error.httpStatus = response.status;
    throw error;
  }
  return result.data;
}

module.exports = {reply};
