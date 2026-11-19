'use strict';

const identities = {
  wecom: {label: '企业微信 UserID', hint: '这是当前企业内的成员标识，不是博客作者 ID。'},
  wechat: {label: '微信公众号 OpenID', hint: '可填入“公众号允许发布的 OpenID”；它仅属于当前公众号。'},
  feishu: {label: '飞书 OpenID', hint: '可填入“飞书允许发布的 OpenID”；它仅属于当前应用。'},
  qq: {label: 'QQ 机器人 OpenID', hint: '可填入“QQ 允许发布的 OpenID”；它不是数字 QQ 号，仅属于当前机器人。'}
};

function isWhoami(text) {
  return typeof text === 'string' && text.trim() === '/whoami';
}

// Call only after platform authentication; the identity comes from the event sender, never command arguments.
function whoami(channel, text, senderId) {
  if (!isWhoami(text)) return null;
  const identity = identities[channel];
  if (!identity) throw new TypeError('Unknown publishing channel');
  if (typeof senderId !== 'string' || !/^[A-Za-z0-9_@.-]{1,256}$/.test(senderId)) {
    return {reply: '无法获取当前发送者标识，请检查平台事件配置。'};
  }
  return {reply: `你的${identity.label}：${senderId}\n${identity.hint}`};
}

module.exports = {isWhoami, whoami};
