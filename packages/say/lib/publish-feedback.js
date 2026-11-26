'use strict';

const crypto = require('node:crypto');

const stages = {save: '保存碎语', merge: '合并碎语', download: '下载附件', upload: '上传附件',
  enrich: '读取链接信息', process: '处理消息', reply: '发送结果回复'};
const hints = new Map([
  ['At least two say IDs are required', '请提供至少两个碎语 ID。'],
  ['One or more says were not found', '部分碎语不存在，请核对 ID。'],
  ['Selected says do not match a supported merge rule', '这些碎语类型不能合并。'],
  ['Say content is required', '文本内容不能为空。'],
  ['Valid latitude and longitude are required', '位置坐标无效，请重新发送位置。'],
  ['Firekylin upload provider is not configured', '请先在后台配置文件上传服务。'],
  ['Media content does not match its declared type', '附件内容与文件类型不一致，请检查文件。'],
  ['Unable to read NetEase Music metadata', '网易云音乐接口暂时不可用，请稍后重试。'],
  ['Invalid Feishu message resource', '附件标识无效，请重新发送附件。'],
  ['Feishu resource exceeds 20 MB', '附件超过 20 MB，请缩小后重试。'],
  ['Feishu App Secret is not configured', '请在后台配置飞书 App Secret。']
]);

async function step(stage, operation) {
  try {
    return await operation();
  } catch (cause) {
    const error = new Error('Say publishing step failed', {cause});
    error.sayStage = stage;
    throw error;
  }
}

function diagnostic(error, fallback = 'process') {
  const stage = stages[error?.sayStage] || stages[fallback] || stages.process;
  const cause = error?.cause || error;
  if (error?.code === 'MEDIA_REGISTRATION_FAILED' || cause?.code === 'MEDIA_REGISTRATION_FAILED') {
    return '文件已上传，但媒体登记失败。请先核对后台媒体记录和存储文件，勿直接重发。';
  }
  const hint = hints.get(cause?.message);
  const code = Number.isSafeInteger(cause?.feishuCode) && cause.feishuCode !== 0
    ? `（飞书错误码 ${cause.feishuCode}）`
    : Number.isInteger(cause?.httpStatus) && cause.httpStatus >= 400 && cause.httpStatus <= 599
      ? `（HTTP ${cause.httpStatus}）` : '';
  const systemHints = {QQ_PUBLISH_DENIED: 'QQ 发布已关闭或发布者授权已变更。',
    QQ_MEDIA_URL_DENIED: '附件下载地址必须是公网 HTTPS 地址，且不能包含登录凭据或自定义端口。',
    QQ_API_FAILED: 'QQ 接口调用失败，请检查机器人权限、沙箱模式和出口 IP 白名单。',
    QQ_DOWNLOAD_FAILED: 'QQ 附件下载失败，请检查附件有效期与网络。',
    MEDIA_TYPE_UNSUPPORTED: '平台返回的附件类型暂不支持，请根据参考编号查看文件类型诊断。',
    MEDIA_TYPE_MISMATCH: '附件内容无法识别或与声明的类型不一致，请根据参考编号查看格式诊断。',
    MEDIA_SIZE_INVALID: '附件为空或超过 20 MB，请检查文件大小。',
    PLUGIN_MEDIA_DENIED: '插件媒体权限不足或插件已停用，请检查插件状态及授权。',
    MEDIA_OWNER_DENIED: '配置的作者不可用或无上传权限，请检查作者账号。',
    ECONNREFUSED: '连接被拒绝，请检查数据库或上游服务是否可访问。',
    ETIMEDOUT: '连接超时，请检查网络和服务状态。',
    ENOTFOUND: '域名解析失败，请检查数据库或上游服务地址。',
    '28P01': '数据库认证失败，请检查数据库账号配置。',
    '42501': '数据库权限不足，请检查写入权限。',
    ER_ACCESS_DENIED_ERROR: '数据库认证失败，请检查数据库账号配置。'};
  if (Object.hasOwn(systemHints, cause?.code)) return `${stage}失败：${cause.code}，${systemHints[cause.code]}`;
  // Never echo arbitrary exception messages, URLs, SQL or provider response bodies.
  if (hint) return `${stage}失败：${hint}`;
  if (['TimeoutError', 'AbortError'].includes(cause?.name)) return `${stage}超时，请检查网络或服务状态。`;
  if (/^Feishu token error:/.test(cause?.message || '')) {
    return `${stage}失败：获取飞书访问凭证失败${code}，请检查 App ID 和 App Secret。`;
  }
  if (/^Feishu resource (?:download )?error:/.test(cause?.message || '')) {
    return `${stage}失败：飞书附件接口报错${code}，请检查消息资源读取权限和附件是否有效。`;
  }
  if (Number.isSafeInteger(cause?.feishuCode)) return `${stage}失败：飞书错误码 ${cause.feishuCode}，请检查机器人发消息权限及可用范围。`;
  if (Number.isInteger(cause?.httpStatus) && cause.httpStatus >= 400 && cause.httpStatus <= 599) {
    return `${stage}失败：HTTP ${cause.httpStatus}，请检查接口权限和服务状态。`;
  }
  return `${stage}失败，请检查后台日志和相关服务配置。`;
}

// Server-only metadata: never serialize an Error or provider response directly.
const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'TimeoutError',
  'AbortError', 'AggregateError', 'DatabaseError', 'QueryFailedError', 'SequelizeDatabaseError',
  'SequelizeConnectionError', 'SequelizeValidationError', 'AxiosError', 'FetchError']);
const errorCodes = new Set(['QQ_PUBLISH_DENIED', 'QQ_MEDIA_URL_DENIED', 'QQ_API_FAILED',
  'QQ_DOWNLOAD_FAILED', 'QQ_TOKEN_INVALID', 'QQ_GATEWAY_DENIED', 'MEDIA_TYPE_UNSUPPORTED', 'MEDIA_TYPE_MISMATCH', 'MEDIA_SIZE_INVALID',
  'MEDIA_REGISTRATION_FAILED', 'PLUGIN_MEDIA_DENIED', 'MEDIA_OWNER_DENIED',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'EPIPE', 'EACCES', 'ENOSPC', 'ENOENT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET', '28P01', '42501', '23502', '23503', '23505', '42P01', '42703', '53300',
  '57P01', '08006', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE',
  'ER_BAD_FIELD_ERROR', 'ER_DUP_ENTRY', 'ER_DATA_TOO_LONG', 'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'SQLITE_BUSY', 'SQLITE_CONSTRAINT',
  'SQLITE_READONLY', 'SQLITE_FULL', 'SQLITE_ERROR', 'AccessDenied', 'InvalidAccessKeyId',
  'SignatureDoesNotMatch', 'NoSuchBucket', 'RequestTimeout', 'SlowDown', 'ExpiredToken']);

const downloadNetworkCodes = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ABORT_ERR',
  'ERR_INVALID_IP_ADDRESS', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_STREAM_PREMATURE_CLOSE'
]);

// Only known media labels are logged; never serialize arbitrary upstream headers or bytes.
const diagnosticMimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'audio/mpeg', 'audio/amr', 'audio/amr-wb', 'audio/ogg', 'audio/opus', 'audio/aac',
  'audio/mp4', 'audio/x-m4a', 'audio/silk', 'audio/wav', 'audio/x-wav',
  'application/octet-stream', 'application/ogg', 'video/mp4', 'unknown']);

function logDetails(error, fallback = 'process') {
  const stage = Object.hasOwn(stages, error?.sayStage) ? error.sayStage
    : Object.hasOwn(stages, fallback) ? fallback : 'process';
  const causes = [];
  const seen = new Set();
  for (let cause = error; cause && causes.length < 5 && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    const detail = {type: errorNames.has(cause.name) ? cause.name : 'UnknownError'};
    if (errorCodes.has(cause.code)) detail.code = cause.code;
    if (['MEDIA_TYPE_UNSUPPORTED', 'MEDIA_TYPE_MISMATCH', 'MEDIA_SIZE_INVALID'].includes(cause.code)) {
      const media = cause.media || {};
      detail.media = {
        mime: diagnosticMimes.has(media.mime) ? media.mime : 'other',
        detected: diagnosticMimes.has(media.detected) ? media.detected : 'unknown'
      };
      if (Number.isSafeInteger(media.bytes) && media.bytes >= 0) detail.media.bytes = media.bytes;
    }
    if (cause.code === 'QQ_DOWNLOAD_FAILED' && cause.download) {
      const download = cause.download;
      detail.download = {};
      if (['url', 'dns', 'connect', 'response', 'redirect', 'body'].includes(download.phase)) {
        detail.download.phase = download.phase;
      }
      if (['deadline', 'redirect_limit', 'redirect_location_missing', 'request_failed'].includes(download.reason)) {
        detail.download.reason = download.reason;
      }
      if (Number.isInteger(download.hop) && download.hop >= 0 && download.hop <= 3) {
        detail.download.hop = download.hop;
      }
      if (Array.isArray(download.networkCodes)) {
        detail.download.networkCodes = download.networkCodes.filter(code => downloadNetworkCodes.has(code)).slice(0, 8);
      }
    }
    if (Number.isSafeInteger(cause.qqCode)) detail.qqCode = cause.qqCode;
    if (Number.isSafeInteger(cause.feishuCode)) detail.feishuCode = cause.feishuCode;
    // Common fetch, Axios and AWS SDK status fields. No response bodies are read.
    const status = [cause.httpStatus, cause.status, cause.statusCode,
      cause.response?.status, cause.$metadata?.httpStatusCode]
      .find(value => Number.isInteger(value) && value >= 400 && value <= 599);
    if (status !== undefined) detail.httpStatus = status;
    causes.push(detail);
  }
  return JSON.stringify({stage, causes});
}

function reference(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function success(item, action = 'publish') {
  return action === 'merge' || item.autoMerged ? `✅ 已合并为碎语 #${item.id}。` : `✅ 发布成功，碎语 #${item.id}。`;
}

function failure(error, key, logger) {
  const ref = reference(key);
  const detail = diagnostic(error);
  logger?.error?.(`say: ${ref}: ${detail} ${logDetails(error)}`);
  return `❌ ${detail}\n请先核对后台是否已保存，避免重复发布。参考编号：${ref}`;
}

async function receive(operation, key, logger) {
  try {
    const result = await operation();
    return result.reply || success(result.item, result.action);
  } catch (error) {
    return failure(error, key, logger);
  }
}

async function adminResult(operation, action, logger) {
  try {
    const item = await step(action === 'merge' ? 'merge' : 'save', operation);
    return {message: success(item, action), item};
  } catch (error) {
    const safe = new Error(failure(error, crypto.randomUUID(), logger));
    safe.status = error.cause?.status === 400 ? 400 : 500;
    throw safe;
  }
}

const help = '发送文本、图片、语音、位置或链接即可发布碎语；/merge ID1,ID2 合并碎语；/whoami 查看当前平台的发送者标识。';
const unsupported = '暂不支持此消息类型，请发送 /help 查看支持的内容。';

module.exports = {diagnostic, logDetails, reference, step, success, failure, receive, adminResult, help, unsupported};
