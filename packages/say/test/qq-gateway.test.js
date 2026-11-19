'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createQqGateway} = require('../lib/qq-gateway');
const {normalizeSettings} = require('../lib/say-service');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(extra = {}) {
  const settings = normalizeSettings({qqEnabled: true, qqAppId: '123', qqAppSecret: 'secret', qqAllowedOpenIds: 'USER'});
  const timeouts = new Map(), intervals = new Map();
  let id = 0;
  const timers = {setTimeout: (fn, ms) => { timeouts.set(++id, {fn, ms}); return id },
    clearTimeout: key => timeouts.delete(key),
    setInterval: (fn, ms) => { intervals.set(++id, {fn, ms}); return id }, clearInterval: key => intervals.delete(key)};
  const sockets = [], writes = [], replies = [], logs = [], apis = [];
  class Socket {
    constructor(url) { this.url = url; this.handlers = {}; this.sent = []; this.readyState = 1; sockets.push(this) }
    addEventListener(name, fn) { this.handlers[name] = fn }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.readyState = 3; this.handlers.close?.({code: 1000}) }
    message(payload) { this.handlers.message({data: JSON.stringify(payload)}) }
  }
  const service = {settings: async() => ({...settings}), create: async input => { writes.push(input); return {id: 1} }};
  const apiFactory = configuration => {
    apis.push(configuration);
    return {gateway: async() => 'wss://api.bot.qq.com/websocket/', token: async() => 'TOKEN',
      reply: async(...args) => replies.push(args)};
  };
  const runtime = createQqGateway({service, mediaClient: {}, logger: {info: x => logs.push(x), error: x => logs.push(x)},
    WebSocketImpl: Socket, apiFactory, timers, unsupportedRuntime: false, ...extra});
  async function timeout(ms) {
    const entry = [...timeouts].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `missing timeout ${ms}`);
    timeouts.delete(entry[0]); entry[1].fn(); await tick();
  }
  async function start() { runtime.start(); await timeout(0); return sockets[0] }
  const ready = socket => {
    socket.message({op: 10, d: {heartbeat_interval: 1000}});
    socket.message({op: 0, t: 'READY', s: 1, d: {session_id: 'SESSION'}});
  };
  const message = {op: 0, t: 'C2C_MESSAGE_CREATE', s: 2, d: {id: 'MSG', author: {user_openid: 'USER'}, content: 'hello'}};
  return {runtime, settings, service, sockets, apis, writes, replies, logs, timeouts, intervals, timeout, start, ready, message};
}

test('QQ identifies after Hello, publishes C2C and resumes without duplicate writes', async() => {
  const f = fixture();
  const socket = await f.start();
  f.ready(socket);
  assert.deepEqual(socket.sent[0], {op: 2, d: {token: 'QQBot TOKEN', intents: 1 << 25, shard: [0, 1]}});
  socket.message(f.message); await tick();
  assert.equal(f.writes.length, 1);
  socket.handlers.close({code: 1006}); await f.timeout(1000);
  const second = f.sockets[1];
  second.message({op: 10, d: {heartbeat_interval: 1000}});
  assert.deepEqual(second.sent[0], {op: 6, d: {token: 'QQBot TOKEN', session_id: 'SESSION', seq: 2}});
  second.message(f.message); await tick();
  assert.equal(f.writes.length, 1);
  await f.runtime.stop();
  assert.equal(f.timeouts.size, 0); assert.equal(f.intervals.size, 0);
});

test('QQ missing heartbeat ACK reconnects with backoff; invalid session re-identifies', async() => {
  const f = fixture(), socket = await f.start();
  f.ready(socket); await tick();
  const beat = [...f.intervals.values()].find(timer => timer.ms === 1000).fn;
  beat(); assert.deepEqual(socket.sent[1], {op: 1, d: 1});
  socket.message({op: 11}); beat();
  assert.equal(socket.readyState, 1);
  beat(); assert.equal(socket.readyState, 3);
  await f.timeout(1000);
  f.sockets[1].message({op: 9, d: false}); await f.timeout(2000);
  f.sockets[2].message({op: 10, d: {heartbeat_interval: 1000}});
  assert.equal(f.sockets[2].sent[0].op, 2);
  await f.runtime.stop();
});

test('QQ stop invalidates an outstanding gateway lookup before it opens a socket', async() => {
  let unblock;
  const deferred = new Promise(resolve => { unblock = resolve });
  const f = fixture({apiFactory: () => ({gateway: () => deferred, token: async() => 'T'})});
  f.runtime.start(); await f.timeout(0);
  await f.runtime.stop(); unblock('wss://api.bot.qq.com/websocket/'); await tick();
  assert.equal(f.sockets.length, 0);
  assert.equal(f.timeouts.size, 0);
});

test('QQ settings disable during connection lookup prevents a late connection', async() => {
  let unblock;
  const deferred = new Promise(resolve => { unblock = resolve });
  const f = fixture({apiFactory: () => ({gateway: () => deferred, token: async() => 'T'})});
  f.runtime.start(); await f.timeout(0);
  f.settings.qqEnabled = false; await f.runtime.refresh();
  unblock('wss://api.bot.qq.com/websocket/'); await tick();
  assert.equal(f.sockets.length, 0);
  await f.runtime.stop();
});

test('QQ settings reconnect with new credentials; late events from old connection ignored', async() => {
  const f = fixture(), socket = await f.start();
  f.ready(socket); await tick();
  f.settings.qqAppSecret = 'rotated'; await f.runtime.refresh(); await tick();
  assert.equal(socket.readyState, 3);
  assert.equal(f.apis[1].qqAppSecret, 'rotated');
  socket.message(f.message); await tick();
  assert.equal(f.writes.length, 0);
  f.settings.qqEnabled = false; await f.runtime.refresh();
  assert.equal(f.sockets[1].readyState, 3);
  await f.runtime.stop();
});

test('QQ disabled configuration and unsupported runtimes never open connections', async() => {
  const disabled = fixture(); disabled.settings.qqEnabled = false;
  await disabled.start(); assert.equal(disabled.sockets.length, 0); await disabled.runtime.stop();
  const cluster = fixture({unsupportedRuntime: true});
  await cluster.start(); assert.equal(cluster.sockets.length, 0);
  assert.match(cluster.logs[0], /unsupported/); await cluster.runtime.stop();
});

test('QQ malformed frame reconnects without leaking payload or secrets to logs', async() => {
  const f = fixture(), socket = await f.start();
  socket.handlers.message({data: 'SECRET malformed JSON'});
  assert.equal(socket.readyState, 3);
  assert.ok(!f.logs.join('').includes('SECRET'));
  await f.runtime.stop();
});

test('QQ processes messages serially and stop drains an already-started save without a late reply', async() => {
  const f = fixture();
  let unblock;
  f.service.create = async input => { f.writes.push(input); await new Promise(resolve => { unblock = resolve }); return {id: 1} };
  const socket = await f.start(); f.ready(socket);
  socket.message(f.message); socket.message({...f.message, s: 3, d: {...f.message.d, id: 'NEXT'}});
  await tick(); assert.equal(f.writes.length, 1);
  const stop = f.runtime.stop(); unblock(); await stop;
  assert.equal(f.writes.length, 1); assert.equal(f.replies.length, 0);
});
