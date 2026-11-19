'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {whoami} = require('../lib/commands');
const {help} = require('../lib/publish-feedback');

test('shared whoami only describes the event sender for each channel', () => {
  for (const [channel, label] of [['wecom', 'UserID'], ['wechat', 'OpenID'], ['feishu', 'OpenID'], ['qq', 'OpenID']]) {
    assert.match(whoami(channel, ' /whoami\n', 'current_user').reply, new RegExp(label + '：current_user'));
    assert.equal(whoami(channel, '/whoami someone_else', 'current_user'), null);
    assert.equal(whoami(channel, 'hello /whoami', 'current_user'), null);
    assert.doesNotMatch(whoami(channel, '/whoami', 'bad\nsecret').reply, /secret/);
    assert.match(whoami(channel, '/whoami', '').reply, /无法获取/);
  }
  assert.match(help, /\/whoami/);
});
