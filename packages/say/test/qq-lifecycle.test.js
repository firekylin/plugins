'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin');
const {SayService, normalizeSettings} = require('../lib/say-service');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Say lifecycle starts QQ only after activation and injects host media into private publishing', async t => {
  const timeouts = new Map(), intervals = new Map();
  let id = 0;
  t.mock.method(global, 'setTimeout', (fn, ms) => { timeouts.set(++id, {fn, ms}); return id });
  t.mock.method(global, 'clearTimeout', key => timeouts.delete(key));
  t.mock.method(global, 'setInterval', (fn, ms) => { intervals.set(++id, {fn, ms}); return id });
  t.mock.method(global, 'clearInterval', key => intervals.delete(key));
  const sockets = [], writes = [], uploads = [], responses = [];
  class Socket {
    constructor() { this.handlers = {}; this.readyState = 1; sockets.push(this) }
    addEventListener(event, fn) { this.handlers[event] = fn }
    send() {}
    close() { this.readyState = 3 }
    emit(data) { this.handlers.message({data: JSON.stringify(data)}) }
  }
  const previous = global.WebSocket;
  global.WebSocket = Socket;
  t.after(async() => { await plugin.deactivate(); global.WebSocket = previous });
  const settings = normalizeSettings({qqEnabled: true, qqAppId: '123', qqAppSecret: 'secret', qqAllowedOpenIds: 'USER', authorId: 7});
  t.mock.method(SayService.prototype, 'settings', async() => ({...settings}));
  t.mock.method(SayService.prototype, 'create', async(input, author) => { writes.push({input, author}); return {id: 7} });
  t.mock.method(global, 'fetch', async(url, options) => {
    const address = String(url);
    if (address.endsWith('getAppAccessToken')) return Response.json({access_token: 'TOKEN', expires_in: 7200});
    if (address.endsWith('/gateway')) return Response.json({url: 'wss://api.bot.qq.com/websocket/'});
    if (address.includes('/messages')) { responses.push(JSON.parse(options.body)); return Response.json({id: 'reply'}) }
    return new Response(Buffer.from('ffd8ffe00000', 'hex'), {headers: {'Content-Type': 'image/jpeg'}});
  });
  const noop = () => {};
  plugin.register({logger: {info: noop, error: noop}, media: {upload: async input => {
    uploads.push(input); return {url: 'https://storage.test/qq.jpg', id: 5};
  }}, widgets: {Widget: class {}, register: noop}, templates: {registerFunction: noop}, routes: {register: noop},
  admin: {registerPanel: noop, registerPage: noop, registerForm: noop, registerAction: noop}});
  assert.equal(timeouts.size, 0);
  plugin.activate();
  const start = [...timeouts].find(([, timer]) => timer.ms === 0);
  timeouts.delete(start[0]); start[1].fn(); await tick();
  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  socket.emit({op: 10, d: {heartbeat_interval: 45000}});
  socket.emit({op: 0, t: 'READY', s: 1, d: {session_id: 'S'}});
  socket.emit({op: 0, t: 'C2C_MESSAGE_CREATE', s: 2, d: {id: 'M', author: {user_openid: 'USER'},
    content: 'caption', attachments: [{content_type: 'image/jpeg', url: 'https://nt.qq.com/a', filename: 'a.jpg'}]}});
  await tick(); await tick();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].ownerId, 7);
  assert.deepEqual(writes[0], {input: {kind: 'textpic', text: 'caption', images: ['https://storage.test/qq.jpg'],
    status: 'public', source: 'QQ'}, author: 7});
  assert.match(responses[0].content, /#7/);
  await plugin.deactivate();
  assert.equal(socket.readyState, 3);
  assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0);
});
