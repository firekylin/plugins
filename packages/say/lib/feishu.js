'use strict';

const crypto = require('node:crypto');

function safeEqual(left, right) {
  left = Buffer.from(String(left || ''));
  right = Buffer.from(String(right || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function signature(timestamp, nonce, encryptKey, body) {
  return crypto.createHash('sha256').update(String(timestamp || '') + String(nonce || '') +
    String(encryptKey || '')).update(String(body || '')).digest('hex');
}

function verify({timestamp, nonce, encryptKey, body, value, now = Date.now}) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now() / 1000 - seconds) > 300) return false;
  return safeEqual(signature(timestamp, nonce, encryptKey, body), value);
}

function decrypt(value, encryptKey) {
  const encrypted = Buffer.from(String(value || ''), 'base64');
  if (encrypted.length <= 16) throw new Error('Invalid Feishu encrypted event');
  const key = crypto.createHash('sha256').update(String(encryptKey || '')).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, encrypted.subarray(0, 16));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]).toString());
}

function eventToken(payload) {
  return payload?.header?.token || payload?.token || '';
}

function messageEvent(payload) {
  if (payload?.header?.event_type !== 'im.message.receive_v1') return null;
  const event = payload.event || {};
  const message = event.message || {};
  let content = {};
  try { content = JSON.parse(message.content || '{}') } catch { content = {} }
  return {
    eventId: payload.header.event_id || '',
    openId: event.sender?.sender_id?.open_id || '',
    messageId: message.message_id || '',
    messageType: message.message_type || '',
    content,
    mentions: Array.isArray(message.mentions) ? message.mentions : []
  };
}

module.exports = {decrypt, eventToken, messageEvent, signature, verify};
