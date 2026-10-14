'use strict';

const crypto = require('node:crypto');

function xmlValue(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escaped}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${escaped}>`, 'i').exec(String(xml || ''));
  return match ? String(typeof match[1] === 'string' ? match[1] : match[2]).trim() : '';
}

function parseXml(xml) {
  const fields = ['ToUserName', 'FromUserName', 'CreateTime', 'MsgType', 'Content', 'PicUrl', 'MediaId',
    'Format', 'Location_X', 'Location_Y', 'Scale', 'Label', 'Title', 'Description', 'Url', 'Encrypt'];
  return Object.fromEntries(fields.map(name => [name, xmlValue(xml, name)]));
}

function signature(token, timestamp, nonce, encrypted) {
  return crypto.createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex');
}

function safeEqual(left, right) {
  left = Buffer.from(String(left || ''));
  right = Buffer.from(String(right || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function keyFrom(value) {
  if (!/^[A-Za-z0-9+/]{43}$/.test(String(value || ''))) throw new Error('Invalid WeCom EncodingAESKey');
  const key = Buffer.from(`${value}=`, 'base64');
  if (key.length !== 32) throw new Error('Invalid WeCom EncodingAESKey');
  return key;
}

function unpad(buffer) {
  const padding = buffer[buffer.length - 1];
  if (padding < 1 || padding > 32) throw new Error('Invalid WeCom message padding');
  return buffer.subarray(0, buffer.length - padding);
}

function pad(buffer) {
  const padding = 32 - (buffer.length % 32 || 32) || 32;
  return Buffer.concat([buffer, Buffer.alloc(padding, padding)]);
}

function decrypt(encrypted, encodingAESKey, receiveId) {
  const key = keyFrom(encodingAESKey);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const plaintext = unpad(Buffer.concat([decipher.update(String(encrypted), 'base64'), decipher.final()]));
  const length = plaintext.readUInt32BE(16);
  const message = plaintext.subarray(20, 20 + length).toString();
  const actualReceiveId = plaintext.subarray(20 + length).toString();
  if (receiveId && actualReceiveId !== receiveId) throw new Error('Invalid WeCom receive ID');
  return message;
}

function encrypt(message, encodingAESKey, receiveId) {
  const key = keyFrom(encodingAESKey);
  const body = Buffer.from(String(message));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const plaintext = pad(Buffer.concat([crypto.randomBytes(16), length, body, Buffer.from(String(receiveId || ''))]));
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
}

function verify({token, timestamp, nonce, encrypted, msgSignature}) {
  return safeEqual(signature(token, timestamp, nonce, encrypted), msgSignature);
}

function encryptedReply(message, settings, timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(8).toString('hex')) {
  const encrypted = encrypt(message, settings.wecomEncodingAESKey, settings.wecomCorpId);
  const digest = signature(settings.wecomToken, timestamp, nonce, encrypted);
  return `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt><MsgSignature><![CDATA[${digest}]]></MsgSignature>` +
    `<TimeStamp>${timestamp}</TimeStamp><Nonce><![CDATA[${nonce}]]></Nonce></xml>`;
}

function textReply(to, from, content) {
  return `<xml><ToUserName><![CDATA[${to}]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName>` +
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType>` +
    `<Content><![CDATA[${String(content).replaceAll(']]>', ']]]]><![CDATA[>')}]]></Content></xml>`;
}

module.exports = {decrypt, encrypt, encryptedReply, parseXml, safeEqual, signature, textReply, verify, xmlValue};
