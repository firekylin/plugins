'use strict';

const cluster = require('node:cluster');
const {createQqApi} = require('./qq-api');
const {createQqPublisher} = require('./qq-publisher');
const feedback = require('./publish-feedback');

function createQqGateway({service, mediaClient, logger, WebSocketImpl = global.WebSocket,
  apiFactory = createQqApi, unsupportedRuntime = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ||
    (cluster.isWorker && Number(process.env.THINK_WORKERS) !== 1)),
  timers = {setTimeout, clearTimeout, setInterval, clearInterval}}) {
  let active = false;
  let revision = 0;
  let socket;
  let reconnect;
  let heartbeat;
  let watchdog;
  let poll;
  let connecting = false;
  let ack = true;
  let session;
  let sequence = null;
  let configuration;
  let api;
  let failures = 0;
  let queue = Promise.resolve();
  let queued = 0;
  const receive = createQqPublisher({service, mediaClient, logger, isActive: () => active});
  const schedule = (callback, delay) => {
    const handle = timers.setTimeout(callback, delay);
    handle?.unref?.();
    return handle;
  };
  function log(error) { logger?.error?.(`say: QQ connection ${feedback.logDetails(error)}`) }
  function disconnect() {
    timers.clearInterval(heartbeat);
    timers.clearTimeout(watchdog);
    const previous = socket;
    socket = null;
    previous?.close();
  }
  function retry() {
    disconnect();
    if (!active || reconnect) return;
    reconnect = schedule(() => { reconnect = null; void connect() },
      Math.min(60000, 1000 * 2 ** Math.min(failures++, 6)));
  }
  async function connect() {
    if (!active || connecting || socket) return;
    connecting = true;
    const attempt = revision;
    try {
      const next = await service.settings();
      if (!active) return;
      if (!next.enabled || !next.qqEnabled || !next.qqAppId || !next.qqAppSecret) return;
      if (unsupportedRuntime) {
        logger?.error?.('say: QQ requires one persistent worker; this Serverless or multi-worker runtime is unsupported.');
        return;
      }
      if (!configuration || ['qqAppId', 'qqAppSecret', 'qqSandbox'].some(key => next[key] !== configuration[key])) {
        configuration = {...next};
        api = apiFactory(configuration);
        session = null;
        sequence = null;
      }
      const currentApi = api;
      const currentConfiguration = configuration;
      const url = await currentApi.gateway();
      const token = await currentApi.token();
      if (!active || attempt !== revision) return;
      const ws = new WebSocketImpl(url);
      socket = ws;
      const send = payload => {
        if (socket === ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
      };
      watchdog = schedule(() => { if (socket === ws) retry() }, 15000);
      ws.addEventListener('message', event => {
        if (!active || socket !== ws) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 1024 * 1024) throw new Error('Invalid QQ frame');
          const payload = JSON.parse(event.data);
          if (payload.op === 10) {
            const interval = payload.d?.heartbeat_interval;
            if (!Number.isInteger(interval) || interval < 1000 || interval > 120000) throw new Error('Invalid heartbeat');
            timers.clearInterval(heartbeat);
            ack = true;
            heartbeat = timers.setInterval(() => {
              if (socket !== ws) return;
              if (!ack) return retry();
              ack = false;
              send({op: 1, d: sequence});
            }, interval);
            heartbeat?.unref?.();
            send(session ? {op: 6, d: {token: `QQBot ${token}`, session_id: session, seq: sequence}}
              : {op: 2, d: {token: `QQBot ${token}`, intents: 1 << 25, shard: [0, 1]}});
          } else if (payload.op === 11) ack = true;
          else if (payload.op === 1) send({op: 1, d: sequence});
          else if (payload.op === 7 || payload.op === 9) {
            if (payload.op === 9) { session = null; sequence = null }
            retry();
          } else if (payload.op === 0) {
            if (payload.t === 'READY' || payload.t === 'RESUMED') {
              if (payload.t === 'READY') {
                if (typeof payload.d?.session_id !== 'string') throw new Error('Missing session');
                session = payload.d.session_id;
              }
              failures = 0;
              timers.clearTimeout(watchdog);
              logger?.info?.('say: QQ WebSocket ready (private messages only).');
            }
            if (queued >= 32) return retry();
            queued++;
            queue = queue.then(async() => {
              if (!active) return;
              await receive(payload, currentApi, currentConfiguration);
              // Advance only after processing; replayed events hit process-local receipts.
              if (configuration === currentConfiguration && Number.isSafeInteger(payload.s)) sequence = payload.s;
            }).catch(log).finally(() => { queued-- });
          }
        } catch (error) { log(error); retry() }
      });
      ws.addEventListener('error', () => { if (socket === ws) retry() });
      ws.addEventListener('close', event => {
        if (socket !== ws) return;
        if ([4006, 4007, 4009].includes(event.code)) { session = null; sequence = null }
        retry();
      });
    } catch (error) { log(error); retry() }
    finally { connecting = false }
  }
  async function refresh() {
    if (!active) return;
    try {
      const next = await service.settings();
      if (!active) return;
      if (!next.enabled || !next.qqEnabled || !next.qqAppId || !next.qqAppSecret ||
          (configuration && ['qqAppId', 'qqAppSecret', 'qqSandbox'].some(key => next[key] !== configuration[key]))) {
        revision++;
        disconnect();
        timers.clearTimeout(reconnect);
        reconnect = null;
      }
      if (!reconnect) void connect();
    } catch (error) { log(error) }
  }
  return {
    start() {
      if (active) return;
      active = true;
      // Do not start network work until PluginManager has marked activation complete.
      reconnect = schedule(() => { reconnect = null; void connect() }, 0);
      poll = timers.setInterval(() => { void refresh() }, 30000);
      poll?.unref?.();
    },
    refresh,
    async stop() {
      active = false;
      revision++;
      timers.clearTimeout(reconnect);
      reconnect = null;
      timers.clearInterval(poll);
      disconnect();
      await queue;
    }
  };
}

module.exports = {createQqGateway};
