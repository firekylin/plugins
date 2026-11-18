'use strict';

const crypto = require('node:crypto');
const {feishuAccessToken} = require('./media');

const stages = {save: '保存碎语', merge: '合并碎语', download: '下载飞书附件', upload: '上传附件',
  enrich: '读取链接信息', process: '处理消息', reply: '发送飞书回复'};
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
    const error = new Error('Feishu publishing step failed', {cause});
    error.sayStage = stage;
    throw error;
  }
}

function diagnostic(error, fallback = 'process') {
  const stage = stages[error?.sayStage] || stages[fallback] || stages.process;
  const cause = error?.cause || error;
  const hint = hints.get(cause?.message);
  const code = Number.isSafeInteger(cause?.feishuCode) && cause.feishuCode !== 0
    ? `（飞书错误码 ${cause.feishuCode}）`
    : Number.isInteger(cause?.httpStatus) && cause.httpStatus >= 400 && cause.httpStatus <= 599
      ? `（HTTP ${cause.httpStatus}）` : '';
  const systemHints = {ECONNREFUSED: '连接被拒绝，请检查数据库或上游服务是否可访问。',
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
const errorCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'EPIPE', 'EACCES', 'ENOSPC', 'ENOENT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET', '28P01', '42501', '23502', '23503', '23505', '42P01', '42703', '53300',
  '57P01', '08006', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE',
  'ER_BAD_FIELD_ERROR', 'ER_DUP_ENTRY', 'ER_DATA_TOO_LONG', 'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'SQLITE_BUSY', 'SQLITE_CONSTRAINT',
  'SQLITE_READONLY', 'SQLITE_FULL', 'SQLITE_ERROR', 'AccessDenied', 'InvalidAccessKeyId',
  'SignatureDoesNotMatch', 'NoSuchBucket', 'RequestTimeout', 'SlowDown', 'ExpiredToken']);

function logDetails(error, fallback = 'process') {
  const stage = Object.hasOwn(stages, error?.sayStage) ? error.sayStage
    : Object.hasOwn(stages, fallback) ? fallback : 'process';
  const causes = [];
  const seen = new Set();
  for (let cause = error; cause && causes.length < 5 && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    const detail = {type: errorNames.has(cause.name) ? cause.name : 'UnknownError'};
    if (errorCodes.has(cause.code)) detail.code = cause.code;
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

module.exports = {diagnostic, logDetails, reference, reply, step};
