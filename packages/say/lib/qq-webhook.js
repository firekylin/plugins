'use strict';
const crypto = require('node:crypto');
const {createQqApi} = require('./qq-api');
const {createQqPublisher} = require('./qq-publisher');

function privateKey(secret) {
  if (typeof secret !== 'string' || !secret) throw new Error('QQ_SECRET_REQUIRED');
  let seed = Buffer.from(secret);
  while (seed.length < 32) seed = Buffer.concat([seed, seed]);
  return crypto.createPrivateKey({key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed.subarray(0, 32)]), format: 'der', type: 'pkcs8'});
}
function fresh(timestamp, now) {
  return /^\d{10}$/.test(String(timestamp)) && Math.abs(now() / 1000 - Number(timestamp)) <= 300;
}
function verify(raw, timestamp, signature, secret, now = Date.now) {
  if (!fresh(timestamp, now) || !/^[a-f0-9]{128}$/i.test(signature || '')) return false;
  return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), raw]), crypto.createPublicKey(privateKey(secret)), Buffer.from(signature, 'hex'));
}

// Atomic unique options.key insert, shared across instances. Never reclaim an uncertain attempt.
// Only hashes and timestamps are stored, never message bodies, OpenIDs or secrets.
function receiptStore(getModel, now = Date.now) {
  return async key => {
    const name = 'plugin_say_qq_receipt_' + crypto.createHash('sha256').update(key).digest('hex');
    try { await getModel('options').add({key: name, value: String(now())}); return true } catch (error) {
      if (!['ER_DUP_ENTRY', '23505', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error.code) &&
          !/duplicate key|unique constraint|UNIQUE constraint failed/i.test(error.message || '')) throw error;
      // Confirm this particular receipt exists; unrelated constraints must not acknowledge a message.
      const existing = await getModel('options').where({key: name}).find();
      if (existing?.key === name) return false;
      throw error;
    }
  };
}

function createQqWebhook({service, mediaClient, logger, getModel, apiFactory = createQqApi, now = Date.now}) {
  const receive = createQqPublisher({service, mediaClient, logger, claim: receiptStore(getModel, now)});
  return async({ctx: request}) => {
    const requestId = crypto.randomUUID();
    const diagnostic = code => {
      // Only call with static codes: never log headers, payloads or exception text.
      try { logger?.info?.(`say: QQ_DIAG ${requestId} ${code}`) } catch { /* Logging must not affect delivery. */ }
    };
    diagnostic('RECEIVED');
    const reject = (status, code, message) => { diagnostic(code); return request.throw(status, message) };
    let settings;
    try { settings = await service.settings() } catch (error) { diagnostic('SETTINGS_FAILED'); throw error }
    if (!settings.enabled || !settings.qqEnabled || !settings.qqAppId || !settings.qqAppSecret) return reject(403, 'DISABLED_OR_UNCONFIGURED');
    if (request.get('X-Bot-Appid') !== settings.qqAppId) return reject(403, 'APP_ID_MISMATCH');
    const source = request.request?.rawBody;
    if (typeof source !== 'string' && !Buffer.isBuffer(source)) return reject(400, 'RAW_BODY_MISSING', 'QQ_RAW_BODY_REQUIRED');
    const raw = Buffer.isBuffer(source) ? source : Buffer.from(source);
    if (raw.length > 1024 * 1024) return reject(413, 'BODY_TOO_LARGE');
    let event;
    try { event = JSON.parse(raw.toString('utf8')) } catch { return reject(400, 'INVALID_JSON') }
    if (!event || typeof event !== 'object') return reject(400, 'INVALID_ENVELOPE');
    request.set('Cache-Control', 'no-store');
    if (event.op === 13) {
      diagnostic('CHALLENGE_RECEIVED');
      const {plain_token: token, event_ts: timestamp} = event.d || {};
      // Restrict unsigned configuration challenges so this cannot sign arbitrary event JSON.
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(token) || !fresh(timestamp, now)) return reject(400, 'CHALLENGE_INVALID');
      const signature = crypto.sign(null, Buffer.from(String(timestamp) + token), privateKey(settings.qqAppSecret)).toString('hex');
      diagnostic('CHALLENGE_ACCEPTED');
      return {plain_token: token, signature};
    }
    if (!fresh(request.get('X-Signature-Timestamp'), now)) return reject(403, 'TIMESTAMP_INVALID');
    if (!verify(raw, request.get('X-Signature-Timestamp'), request.get('X-Signature-Ed25519'), settings.qqAppSecret, now)) return reject(403, 'SIGNATURE_INVALID');
    diagnostic('SIGNATURE_ACCEPTED');
    if (event.op === 0 && event.t === 'C2C_MESSAGE_CREATE') {
      diagnostic('EVENT_C2C_MESSAGE_CREATE');
      try { await receive(event, apiFactory(settings), settings, diagnostic) } catch {
        diagnostic('PROCESSING_FAILED');
        logger?.error?.('say: QQ_WEBHOOK_RECEIPT_FAILED; callback not acknowledged.');
        return request.throw(503, 'QQ_WEBHOOK_UNAVAILABLE');
      }
    } else diagnostic(event.op === 0 ? 'IGNORED_EVENT_TYPE' : 'IGNORED_OPCODE');
    diagnostic('ACK');
    // Finish all work inside the invocation; no detached background tasks or heartbeat timers.
    return {op: 12};
  };
}
module.exports = {createQqWebhook, receiptStore, privateKey, verify};
