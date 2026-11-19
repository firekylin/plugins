'use strict';

const {createHash} = require('node:crypto');
const {strings} = require('./say-service');
const feedback = require('./publish-feedback');
const {whoami} = require('./commands');
const HELP = '发送文本、图片、图文或语音可公开发布碎语；纯链接发布为链接。/merge ID1,ID2 合并；/whoami 查看自己的 OpenID。暂不支持群聊、频道、视频、文件、位置和引用消息。';

// In-memory reply receipts supplement the injected durable claim for Webhook delivery.
function createQqPublisher({service, mediaClient, logger, isActive = () => true, claim = async() => true}) {
  const receipts = new Map();
  const pending = new Map();
  return async function receive(event, api, connection, diagnostic = () => {}) {
    if (event.t !== 'C2C_MESSAGE_CREATE' || !isActive()) { diagnostic('IGNORED_INACTIVE'); return }
    const message = event.d || {};
    const openId = message.author?.user_openid;
    if (typeof openId !== 'string' || !/^[\w-]{1,128}$/.test(openId) ||
        typeof message.id !== 'string' || !message.id || message.id.length > 512) { diagnostic('IGNORED_MESSAGE_SHAPE'); return }
    const settings = await service.settings();
    if (!isActive() || !settings.enabled || !settings.qqEnabled ||
        ['qqAppId', 'qqAppSecret', 'qqSandbox'].some(key => settings[key] !== connection[key])) { diagnostic('IGNORED_CONFIG_CHANGED'); return }
    const text = typeof message.content === 'string' ? message.content.trim() : '';
    const identity = !message.attachments?.length && whoami('qq', text, openId);
    if (!identity && !strings(settings.qqAllowedOpenIds).includes(openId)) { diagnostic('IGNORED_NOT_ALLOWLISTED'); return }
    const ext = message.message_scene?.ext;
    let index = (Array.isArray(ext) ? ext.find(value => typeof value === 'string' && value.startsWith('msg_idx='))?.slice(8)
      : ext?.msg_idx) ?? message.msg_seq ?? '';
    if (typeof index !== 'string' && !(typeof index === 'number' && Number.isFinite(index))) {
      // The index is optional; retain message-ID deduplication if its shape is unknown.
      diagnostic('MESSAGE_INDEX_FALLBACK');
      index = '';
    }
    const digest = createHash('sha256').update(String(index)).digest();
    const replySequence = index === '' ? 1 : 1 + (digest.readUInt32BE(0) % 2147483646);
    // Long opaque platform indexes are valid identifiers, not user-visible text.
    // Keep the complete identifier's digest instead of rejecting or truncating it.
    const receiptIndex = String(index).length > 128 ? ['sha256', digest.toString('hex')] : index;
    if (Array.isArray(receiptIndex)) diagnostic('MESSAGE_INDEX_HASHED');
    const key = JSON.stringify([connection.qqAppId, !!connection.qqSandbox, openId, message.id, receiptIndex]);
    if (pending.has(key)) { diagnostic('DUPLICATE_IN_FLIGHT'); return pending.get(key) }
    if (pending.size >= 32) throw Object.assign(new Error('QQ busy'), {code: 'QQ_BUSY'}); // Bound active downloads and writes under an event flood.
    const operation = (async() => {
      let receipt = receipts.get(key);
      if (!receipt) {
        if (!await claim(key)) { diagnostic('DUPLICATE_CLAIMED'); return }
        diagnostic('CLAIM_ACQUIRED');
        async function authorized() {
          const fresh = await service.settings();
          if (!isActive() || !fresh.enabled || !fresh.qqEnabled || fresh.authorId !== settings.authorId ||
              ['qqAppId', 'qqAppSecret', 'qqSandbox'].some(name => fresh[name] !== connection[name]) ||
              !strings(fresh.qqAllowedOpenIds).includes(openId)) {
            throw Object.assign(new Error('QQ publishing stopped'), {code: 'QQ_PUBLISH_DENIED'});
          }
        }
        async function save(input) {
          await authorized();
          return {item: await feedback.step('save', () => service.create({...input, status: 'public', source: 'QQ'}, settings.authorId))};
        }
        try {
          let result;
          if (identity) { diagnostic('WHOAMI'); result = identity }
          else if (text === '/help') result = {reply: HELP};
          else if ((message.message_type !== undefined && ![0].includes(message.message_type)) || message.msg_elements?.length || message.ark_data) {
            result = {reply: '暂不支持卡片或引用消息，请直接发送文本、图片或语音。'};
          } else if (message.attachments?.length) {
            const attachments = message.attachments;
            const images = attachments.every(item => /^image\/(jpeg|png|gif|webp)$/i.test(item.content_type));
            const voice = attachments.length === 1 && /^(voice$|audio\/|application\/ogg$)/i.test(attachments[0].content_type);
            if (attachments.length > 10 || (!images && !voice)) result = {reply: '暂不支持这些附件或混合类型；请发送最多 10 张图片，或单条语音。'};
            else {
              const urls = [];
              for (const attachment of attachments) {
                await authorized();
                const media = await feedback.step('download', () => api.download(attachment));
                await authorized();
                urls.push(await feedback.step('upload', () => mediaClient.uploadBuffer(media.buffer, {...media, userId: settings.authorId})));
              }
              result = await save(images ? {kind: text ? 'textpic' : 'image', text, images: urls}
                : {kind: 'voice', text, mediaUrl: urls[0]});
            }
          } else if (/^\/merge\s+/.test(text)) {
            await authorized();
            result = {item: await feedback.step('merge', () => service.merge(text.replace(/^\/merge\s+/, ''))), action: 'merge'};
          } else if (text && !text.startsWith('/')) {
            result = await save(/^https?:\/\/\S+$/.test(text)
              ? {kind: 'link', url: text, title: text} : {kind: 'text', text});
          } else result = {reply: HELP};
          diagnostic(result.item ? 'PUBLISH_SUCCEEDED' : 'COMMAND_RESPONSE_READY');
          receipt = {text: result.reply || feedback.success(result.item, result.action), sent: false};
        } catch (error) {
          diagnostic('PUBLISH_FAILED');
          receipt = {text: feedback.failure(error, key, logger), sent: false};
        }
        receipts.set(key, receipt);
        if (receipts.size > 1000) receipts.delete(receipts.keys().next().value);
      }
      if (!receipt.sent && isActive()) {
        try {
          diagnostic('REPLY_STARTED');
          await api.reply(openId, message.id, receipt.text, replySequence);
          receipt.sent = true;
          diagnostic('REPLY_SUCCEEDED');
        } catch (error) {
          diagnostic('REPLY_FAILED');
          logger?.error?.(`say: QQ reply ${feedback.reference(key)} ${feedback.logDetails(error, 'reply')}`);
        }
      } else diagnostic(receipt.sent ? 'REPLY_ALREADY_SENT' : 'REPLY_SKIPPED_INACTIVE');
    })();
    pending.set(key, operation);
    try { return await operation } finally { pending.delete(key) }
  };
}

module.exports = {createQqPublisher};
