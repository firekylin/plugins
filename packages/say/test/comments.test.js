'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {SayComments} = require('../lib/comments');
const {renderComments} = require('../lib/comment-render');

function fixture() {
  const rows = [];
  const settings = {enabled: true, commentsEnabled: false}; // Obsolete stored option must have no effect.
  const item = {id: 7, pathname: 'a&b%2F中文', status: 'public', allowComments: true};
  const options = {comment: {}};
  let user;
  const captcha = {settings: () => ({}), enabled: () => false, publicSettings: () => ({}), verify: async() => true};
  const calls = [];
  const runtime = {options, config: options.comment, core: {comment: {
    async create(input, context) {
      calls.push(['create', input, context]);
      return {objectId: '88', status: 'spam', mail: 'never-forward@example.test'};
    }
  }}};
  const host = {
    create: async() => runtime,
    context: async controller => ({state: {userInfo: user}, ip: controller.ctx.ip, headers: controller.ctx.headers}),
    async validateCommentTarget(controller, url) {
      calls.push(['target', controller, url]);
      return {id: item.id, type: 3};
    },
    validateCommentInput(input, context, config) {
      calls.push(['input', input, context, config]);
    },
    async syncCount(controller, id) { calls.push(['count', controller, id]) }
  };
  const getModel = name => {
    if (name === 'options') return {getOptions: async() => options};
    const source = name === 'post' ? [{id: item.id, pathname: item.pathname, type: 3,
      status: item.status === 'hidden' ? 0 : 3, is_public: item.status === 'public' ? 1 : 0,
      allow_comment: Number(item.allowComments)}] : rows;
    return {
      where(where) { this.condition = where; return this },
      order() { return this },
      field() { return this },
      limit(offset, size) { this.offset = size ? offset : 0; this.size = size || offset; return this },
      filtered() {
        return source.filter(row => Object.entries(this.condition || {}).every(([key, value]) => {
          if (!Array.isArray(value)) return (row[key] ?? null) === (value ?? null);
          if (value[0] === '>') return row[key] > value[1];
          if (value[0] === 'NOT IN') return !value[1].includes(row[key]);
          throw new Error(`Unexpected fixture operator: ${value[0]}`);
        }));
      },
      async count() { return this.filtered().length },
      async select() { return this.filtered().slice(this.offset || 0, (this.offset || 0) + (this.size || 20)) },
      async find() { return this.filtered()[0] || {} },
      async add(row) { rows.push({...row, id: rows.length + 1}); return rows.length },
      async update(patch) { if (name === 'post') item.commentCount = patch.comment_num }
    };
  };
  const request = {state: {}, query: {}, ip: '127.0.0.1', protocol: 'https', host: 'blog.test', headers: {},
    referrer: () => 'https://blog.test/says/7', cookie: () => '',
    is: type => type === 'application/json', get: name => ({origin: 'https://blog.test', 'user-agent': 'test-agent'})[name] || ''};
  const comments = new SayComments({say: {settings: async() => settings, get: async() => item}, getModel,
    getService: name => name === 'captcha' ? captcha : host});
  return {rows, item, options, settings, request, comments, captcha, host, runtime, calls, getModel,
    setUser: value => { user = value }};
}
const body = {comment: 'hello', nick: 'Visitor', mail: 'v@example.test'};

test('legacy POST delegates trusted fields and canonical target to core without exposing the result', async() => {
  const f = fixture();
  const result = await f.comments.handle(() => f.comments.submit(7, {...body, captcha: 'proof', status: 'approved',
    user_id: '1', post_id: 99, url: '/fake', ua: 'forged'}, f.request), {...f.request,
    set: (name, value) => assert.deepEqual([name, value], ['Cache-Control', 'no-store'])});
  assert.deepEqual(result, {success: true, data: {message: '评论已提交。'}});
  assert.deepEqual(f.calls.map(call => call[0]), ['target', 'input', 'create', 'count']);
  const [target, input, write, count] = f.calls;
  const url = '/says/7?pathname=a%26b%252F%E4%B8%AD%E6%96%87&type=3';
  assert.equal(target[2], url);
  assert.deepEqual(write[1], {...body, link: '', captcha: 'proof', url, ua: 'test-agent'});
  assert.equal(write[1], input[1]);
  assert.equal(write[2], input[2]);
  assert.equal(input[3], f.runtime.config);
  assert.deepEqual(count, ['count', target[1], 7]);
});

test('requires public, enabled, commentable targets for reads and writes', async() => {
  for (const change of [f => { f.item.status = 'private' }, f => { f.item.status = 'hidden' },
    f => { f.settings.enabled = false }, f => { f.item.allowComments = false }]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.comments.list(7));
    await assert.rejects(f.comments.submit(7, body, f.request));
    assert.deepEqual(f.calls, []);
  }
  await assert.rejects(fixture().comments.list('7oops'), {status: 404});
});

test('requires same-origin JSON and uses the native authenticated account metadata', async() => {
  const f = fixture();
  await assert.rejects(f.comments.submit(7, body, {...f.request, get: () => 'https://evil.test'}), {status: 403});
  await assert.rejects(f.comments.submit(7, body, {...f.request, get: () => ''}), {status: 403});
  await assert.rejects(f.comments.submit(7, body, {...f.request, is: () => false}), {status: 415});
  f.runtime.config.forceLogin = true;
  await assert.rejects(f.comments.submit(7, {comment: 'hello'}, f.request), {status: 401});
  const user = {objectId: '9', display_name: 'Authenticated', email: 'real@example.test'};
  f.setUser(user);
  f.runtime.options.jwt_secret = 'fixture';
  await f.comments.submit(7, body, f.request);
  const [, input, context] = f.calls.find(call => call[0] === 'create');
  assert.equal(input.nick, 'Authenticated');
  assert.equal(input.mail, 'real@example.test');
  assert.equal(input.user_id, undefined);
  assert.equal(context.state.userInfo, user);
  assert.equal(f.request.state.jwtSecret, 'fixture');
});

test('validates legacy fields, rejects mismatched targets and fails closed on incompatible core', async() => {
  for (const value of [{comment: ''}, {comment: 'x'.repeat(5001)}, {nick: ''}, {mail: 'invalid'},
    {link: 'javascript:alert(1)'}, {pid: 3}, {comment: {text: 'x'}}]) {
    const f = fixture();
    await assert.rejects(f.comments.submit(7, {...body, ...value}, f.request), {status: 400});
    assert.deepEqual(f.calls, []);
  }
  for (const post of [{id: 8, type: 3}, {id: 7, type: 0}]) {
    const f = fixture();
    f.host.validateCommentTarget = async() => post;
    await assert.rejects(f.comments.submit(7, body, f.request), {status: 404});
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  delete f.runtime.core.comment.create;
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 503});
  assert.deepEqual(f.calls, []);
});

test('maps native validation and filtering failures to safe legacy HTTP errors', async() => {
  for (const [code, status] of Object.entries({VALIDATION_ERROR: 400, UNAUTHORIZED: 401, FORBIDDEN: 403,
    COMMENT_DISABLED: 403, INVALID_PATH: 404, DUPLICATE_CONTENT: 409, COMMENT_TOO_FAST: 429, unexpected: 503})) {
    const f = fixture();
    f.runtime.core.comment.create = async() => { throw Object.assign(new Error('private detail'), {code}) };
    const result = await f.comments.handle(() => f.comments.submit(7, body, f.request), f.request);
    assert.equal(f.request.status, status);
    assert.equal(result.success, false);
    assert.doesNotMatch(JSON.stringify(result), /private detail/);
    assert.deepEqual(f.calls.map(call => call[0]), ['target', 'input']);
  }
});

test('safe errors hide infrastructure details; rendered comments cannot inject HTML', async() => {
  const f = fixture();
  const result = await f.comments.handle(() => { throw new Error('database password') }, f.request);
  assert.equal(f.request.status, 503);
  assert.doesNotMatch(JSON.stringify(result), /password/);
  const html = renderComments(7, {total: 1, page: 1, pageSize: 20,
    items: [{nick: '<script>bad</script>', comment: '<img onerror=evil>', createdAt: ''}]}, {});
  assert.ok(html.includes('&lt;img onerror=evil&gt;'));
  assert.ok(!html.includes('<script>bad'));
  for (const provider of ['turnstile', 'recaptcha-v3']) {
    const rendered = renderComments(7, {total: 0, page: 1, pageSize: 20, items: []}, {captcha: {provider, siteKey: 'test'}});
    assert.ok(rendered.includes(provider === 'turnstile' ? 'challenges.cloudflare.com' : 'google.com/recaptcha'));
  }
});


test('real core owns guest and admin approval, required metadata, spam, rate limits and count updates',
  {skip: !process.env.FIREKYLIN_CORE_PATH}, async t => {
    const path = require('node:path');
    const crypto = require('node:crypto');
    const Module = require('node:module');
    const root = process.env.FIREKYLIN_CORE_PATH;
    const previousThink = global.think;
    const previousFirekylin = global.firekylin;
    global.think = {Service: class {}, logger: {}, isEmpty: value => !value || !Object.keys(value).length,
      md5: value => crypto.createHash('md5').update(value).digest('hex'),
      datetime: (value = new Date()) => new Date(value).toISOString(), cache: async() => {}};
    global.firekylin = {POST_PUBLISH: 3, POST_PUBLIC: 1, POST_ALLOW_COMMENT: 1, USER_ADMIN: 1};
    t.after(() => {
      global.think = previousThink;
      global.firekylin = previousFirekylin;
    });
    const Host = require(path.join(root, 'src/service/comment'));
    const auth = require(path.join(root, 'src/service/admin-auth'));
    const Moderation = require(path.join(root, 'src/service/comment-moderation'));
    const EventBus = require(path.join(root, 'src/plugin/events'));
    const load = Module._load;
    t.mock.method(Module, '_load', function(name, ...args) {
      if (name === 'firekylin/src/service/comment') return Host;
      return load.call(this, name, ...args);
    });
    const host = new Host();
    const captcha = require(path.join(root, 'src/service/captcha'));
    const verifications = [];
    t.mock.method(captcha, 'verify', async(_config, token, ip, area) => {
      verifications.push([token, ip, area]);
      return token === 'valid-proof';
    });
    for (const [audit, user, message, expected, ai] of [
      [false, false, 'guest message', 'approved'],
      [true, false, 'guest message', 'waiting'],
      [true, true, 'admin message', 'approved'],
      [false, false, 'blocked terms', 'spam'],
      [false, false, 'marked by native AI', 'spam', 'spam'],
      [false, false, 'AI failure goes to review', 'waiting', 'error']
    ]) {
      const f = fixture();
      f.options.jwt_secret = 'a'.repeat(64);
      Object.assign(f.options.comment, {audit, requiredMeta: ['mail'], forbiddenWords: ['blocked']});
      f.options.captcha = {provider: 'turnstile', areas: ['comment']};
      f.comments.getService = name => name === 'comment' ? host : captcha;
      verifications.length = 0;
      const events = new EventBus();
      let aiCalls = 0;
      f.options.ai_content_features = {commentModeration: Boolean(ai)};
      global.firekylin.plugins = {events, ai: {generate: async(_input, context) => {
        assert.equal(context.scenario, 'comment.moderation');
        aiCalls++;
        if (ai === 'error') throw new Error('Fixture AI unavailable');
        return {text: JSON.stringify({spam: true})};
      }}};
      events.on('comment.beforeCreate', data => f.comments.beforeNativeCreate(data));
      let created = 0;
      events.on('comment.created', () => { created++ });
      if (user) {
        f.request.cookie = () => auth.sign({id: 9, type: 1, name: 'Admin'}, f.options.jwt_secret);
        f.comments.getModel = name => name === 'user' ? {where() { return this },
          select: async() => [{id: 9, name: 'Admin', type: 1, status: 1, email: 'admin@example.test'}]} : f.getModel(name);
      } else {
        await assert.rejects(f.comments.submit(7, {...body, mail: ''}, f.request), {status: 400});
        f.options.comment.forceLogin = true;
        await assert.rejects(f.comments.submit(7, body, f.request), {status: 401});
        f.options.comment.forceLogin = false;
        await assert.rejects(f.comments.submit(7, body, f.request), {status: 403});
        f.options.comment.disallowIPList = [f.request.ip];
        await assert.rejects(f.comments.submit(7, {...body, captcha: 'valid-proof'}, f.request), {status: 403});
        f.options.comment.disallowIPList = [];
      }
      const input = {...body, comment: message, status: 'approved', user_id: '1', captcha: 'valid-proof'};
      assert.deepEqual(await f.comments.submit(7, input, f.request), {message: '评论已提交。'});
      assert.equal(f.rows[0].status, expected);
      assert.equal(f.rows[0].post_id, 7);
      assert.equal(f.rows[0].user_id, user ? '9' : undefined);
      assert.equal(f.rows[0].nick, user ? 'Admin' : 'Visitor');
      assert.equal(f.item.commentCount, Number(expected === 'approved'));
      assert.equal((await f.comments.list(7)).total, f.item.commentCount);
      assert.equal(created, 1);
      assert.equal(aiCalls, Number(Boolean(ai)));
      assert.deepEqual(verifications, user ? [] : ['', 'valid-proof', 'valid-proof']
        .map(token => [token, f.request.ip, 'comment']));
      if (!user) {
        await assert.rejects(f.comments.submit(7, {...input, comment: 'another'}, f.request), {status: 429});
        await assert.rejects(f.comments.submit(7, input, f.request), {status: 409});
      }
      if (expected === 'waiting') {
        const counts = [];
        const moderation = new Moderation({getModel: () => {
          let id;
          return {where(where) { id = where.id; return this }, setRelation() { return this },
            find: async() => ({...f.rows.find(row => row.id === id)}),
            update: async patch => Object.assign(f.rows.find(row => row.id === id), patch)};
        }, now: () => new Date().toISOString(), syncCount: async id => { counts.push(id) }});
        await moderation.moderate({id: 1, operation: 'approved'}, {id: 9, type: 1});
        assert.equal((await f.comments.list(7)).items.length, 1);
        assert.deepEqual(counts, [7]);
        await moderation.moderate({id: 1, operation: 'spam'}, {id: 9, type: 1});
        assert.equal((await f.comments.list(7)).items.length, 0);
      }
    }
  });

test('registered detail and comment routes respect visibility without changing native routes', async t => {
  const {SayService} = require('../lib/say-service');
  const routes = [];
  const hooks = [];
  const noop = () => {};
  t.mock.method(SayService.prototype, 'settings', async() => ({enabled: true, commentsEnabled: false}));
  t.mock.method(SayService.prototype, 'publicNeighbors', async() => ({previous: 6, next: 8}));
  const get = t.mock.method(SayService.prototype, 'get', async() => ({id: 7, status: 'public', text: 'hello', tags: []}));
  require('../plugin').register({widgets: {Widget: class {}, register: noop}, events: {on: (name, handler) => hooks.push({name, handler})}, templates: {registerFunction: noop},
    routes: {register: route => routes.push(route)}, admin: {registerPanel: noop, registerPage: noop, registerForm: noop, registerAction: noop}});
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].name, 'comment.beforeCreate');
  assert.equal(typeof hooks[0].handler, 'function');
  assert.equal(routes.filter(route => route.path === '/comments/:id').length, 2);
  assert.ok(routes.every(route => !route.path.startsWith('/api/comment')));
  const detail = routes.find(route => route.path === '/says/:id');
  const request = {set() {}, throw(status) {throw Object.assign(new Error(), {status})}};
  await detail.handler({ctx: request, params: {id: '7'}, query: {}});
  assert.match(request.body, /评论已关闭/);
  assert.match(request.body, /href="\/says\/6" rel="prev"/);
  assert.match(request.body, /href="\/says\/8" rel="next"/);
  t.mock.method(SayService.prototype, 'settings', async() => ({enabled: true, commentsEnabled: false}));
  get.mock.mockImplementation(async() => ({id: 7, pathname: 'example', status: 'public', allowComments: true, text: 'hello', tags: []}));
  t.mock.method(SayComments.prototype, 'configuration', async() => ({options: {}, public: {}}));
  await detail.handler({ctx: request, params: {id: '7'}, query: {}});
  assert.match(request.body, /client.init/);
  assert.doesNotMatch(request.body, /say-comment-form/);
  get.mock.mockImplementation(async() => ({id: 7, status: 'private'}));
  await assert.rejects(detail.handler({ctx: request, params: {id: '7'}, query: {}}), {status: 404});
});

test('keeps the in-flight lock and rechecks a target that closes before native save', async() => {
  const f = fixture();
  let release;
  f.runtime.core.comment.create = () => new Promise(resolve => { release = resolve });
  const first = f.comments.submit(7, body, f.request);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 429});
  release({objectId: '88'});
  await first;
  const other = fixture();
  other.host.validateCommentInput = () => { other.item.status = 'private' };
  await assert.rejects(other.comments.submit(7, body, other.request), {status: 404});
  assert.deepEqual(other.calls.map(call => call[0]), ['target']);
});

test('legacy lists include native and historical URLs by post ID without exposing pending comments', async() => {
  const f = fixture();
  f.rows.push(
    {id: 1, post_id: 7, url: '/says/7', status: 'approved', comment: 'old'},
    {id: 2, post_id: 7, url: '/path?pathname=example&type=3', status: 'approved', comment: 'native'},
    {id: 3, post_id: 7, url: '/path?pathname=example&type=3', status: 'waiting', comment: 'pending'},
    {id: 4, post_id: 8, url: '/says/8', status: 'approved', comment: 'other'}
  );
  const result = await f.comments.list(7);
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map(item => item.comment), ['old', 'native']);
});

test('native comment filter gates Say availability without rewriting the input or status', async t => {
  const Module = require('node:module');
  const original = Module._load;
  const f = fixture();
  let type = 3;
  let resolvedId = 7;
  f.comments.getModel = name => name === 'post'
    ? {where: () => ({field: () => ({find: async() => ({id: 7, type})})})} : f.getModel(name);
  t.mock.method(Module, '_load', function(name, ...args) {
    if (name === 'firekylin/src/service/comment') return {resolveCommentPostId: async() => resolvedId};
    return original.call(this, name, ...args);
  });
  const data = {url: '/says?pathname=example&type=3', comment: 'test'};
  for (const status of ['approved', 'waiting', 'spam', undefined]) {
    const input = Object.freeze({...data, status});
    assert.equal(await f.comments.beforeNativeCreate(input), input);
  }
  f.item.allowComments = false;
  await assert.rejects(f.comments.beforeNativeCreate(data), {status: 403});
  f.item.allowComments = true;
  for (const change of [() => { f.item.status = 'private' }, () => { f.item.status = 'hidden' }, () => {
    f.item.status = 'public';
    f.settings.enabled = false;
  }]) {
    change();
    await assert.rejects(f.comments.beforeNativeCreate(data), {status: 404});
  }
  type = 0;
  assert.equal(await f.comments.beforeNativeCreate(data), data);
  resolvedId = null;
  assert.equal(await f.comments.beforeNativeCreate(data), data);
});
