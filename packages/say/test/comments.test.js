'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {SayComments} = require('../lib/comments');
const {renderComments} = require('../lib/comment-render');

function fixture() {
  const rows = [];
  const settings = {enabled: true, commentsEnabled: false}; // Obsolete stored option must have no effect.
  const item = {id: 7, status: 'public', allowComments: true};
  const options = {comment: {}};
  let user;
  const captcha = {settings: () => ({}), enabled: () => false, publicSettings: () => ({}), verify: async() => true};
  const host = {create: async() => ({}), context: async() => ({state: {userInfo: user}}), validateCommentInput() {}};
  const getModel = name => name === 'options' ? {getOptions: async() => options} : {
    where(where) { this.condition = where; return this }, order() { return this },
    limit(offset, size) { this.offset = offset; this.size = size; return this },
    filtered() { return rows.filter(row => Object.entries(this.condition || {}).every(([key, value]) =>
      Array.isArray(value) ? row[key] > value[1] : row[key] === value)) },
    async count() { return this.filtered().length },
    async select() { return this.filtered().slice(this.offset || 0, (this.offset || 0) + (this.size || 20)) },
    async add(row) { rows.push({...row, id: rows.length + 1}); return rows.length },
    async delete() { for (const row of this.filtered()) rows.splice(rows.indexOf(row), 1) }
  };
  const request = {state: {}, query: {}, ip: '127.0.0.1', protocol: 'https', host: 'blog.test',
    is: type => type === 'application/json', get: name => name === 'origin' ? 'https://blog.test' : ''};
  const comments = new SayComments({say: {settings: async() => settings, get: async() => item}, getModel,
    getService: name => name === 'captcha' ? captcha : host, now: date => (date || new Date()).toISOString()});
  return {rows, item, options, settings, request, comments, captcha, host, getModel, setUser: value => { user = value }};
}
const body = {comment: 'hello', nick: 'Visitor', mail: 'v@example.test'};

test('stores pending comments with canonical target and ignores forged identity/status', async() => {
  const f = fixture();
  await f.comments.submit(7, {...body, status: 'approved', user_id: '1', post_id: 99, url: '/fake'}, f.request);
  assert.equal(f.rows[0].status, 'waiting');
  assert.equal(f.rows[0].post_id, 7);
  assert.equal(f.rows[0].url, '/says/7');
  assert.equal(f.rows[0].user_id, null);
  assert.deepEqual((await f.comments.list(7)).items, []);
  f.rows[0].status = 'approved';
  const listed = await f.comments.list(7);
  assert.equal(listed.total, 1);
  assert.deepEqual(Object.keys(listed.items[0]), ['id', 'nick', 'comment', 'createdAt']);
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 429});
});

test('requires public, enabled, commentable targets for reads and writes', async() => {
  for (const change of [f => { f.item.status = 'private' }, f => { f.item.status = 'hidden' },
    f => { f.settings.enabled = false }, f => { f.item.allowComments = false }]) {
    const f = fixture(); change(f);
    await assert.rejects(f.comments.list(7));
    await assert.rejects(f.comments.submit(7, body, f.request));
    assert.equal(f.rows.length, 0);
  }
  await assert.rejects(fixture().comments.list('7oops'), {status: 404});
});

test('checks origin, JSON, login, captcha and validated account identity', async() => {
  const f = fixture();
  await assert.rejects(f.comments.submit(7, body, {...f.request, get: () => 'https://evil.test'}), {status: 403});
  await assert.rejects(f.comments.submit(7, body, {...f.request, is: () => false}), {status: 415});
  f.options.comment.forceLogin = true;
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 401});
  f.options.comment.forceLogin = false;
  f.captcha.verify = async() => false;
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 403});
  f.setUser({objectId: '9', display_name: 'Authenticated', email: 'real@example.test'});
  await f.comments.submit(7, body, f.request);
  assert.equal(f.rows[0].nick, 'Authenticated');
  assert.equal(f.rows[0].user_id, '9');
  assert.equal(f.rows[0].status, 'waiting');
});

test('validates input and host requirements, rejects duplicates and marks spam', async() => {
  for (const value of [{comment: ''}, {comment: 'x'.repeat(5001)}, {nick: ''}, {mail: 'invalid'},
    {link: 'javascript:alert(1)'}, {pid: 3}, {comment: {text: 'x'}}]) {
    const f = fixture();
    await assert.rejects(f.comments.submit(7, {...body, ...value}, f.request), {status: 400});
  }
  const f = fixture();
  f.host.validateCommentInput = () => { throw new Error('required meta') };
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 400});
  f.host.validateCommentInput = () => {};
  f.options.comment.forbiddenWords = ['hello'];
  await f.comments.submit(7, body, f.request);
  assert.equal(f.rows[0].status, 'spam');
  f.rows[0].inserted_at = '2000-01-01';
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 409});
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


test('real host identity, input validation and moderation interoperate with Say',
  {skip: !process.env.FIREKYLIN_CORE_PATH}, async t => {
    const path = require('node:path');
    const crypto = require('node:crypto');
    const root = process.env.FIREKYLIN_CORE_PATH;
    const previousThink = global.think, previousFirekylin = global.firekylin;
    global.think = {Service: class {}, logger: {error() {}}, isEmpty: value => !value || !Object.keys(value).length,
      md5: value => crypto.createHash('md5').update(value).digest('hex')};
    global.firekylin = {USER_ADMIN: 1, USER_EDITOR: 2, USER_COMMENTER: 4};
    t.after(() => { global.think = previousThink; global.firekylin = previousFirekylin });
    const Host = require(path.join(root, 'src/service/comment'));
    const auth = require(path.join(root, 'src/service/admin-auth'));
    const Moderation = require(path.join(root, 'src/service/comment-moderation'));
    const f = fixture();
    const host = new Host();
    f.options.jwt_secret = 'a'.repeat(64);
    f.options.comment.requiredMeta = ['mail'];
    f.request.cookie = () => '';
    f.request.referrer = () => 'https://blog.test/says/7';
    f.request.headers = {};
    f.comments.getService = name => name === 'comment' ? host : require(path.join(root, 'src/service/captcha'));
    await assert.rejects(f.comments.submit(7, {...body, mail: ''}, f.request), {status: 400});
    await f.comments.submit(7, body, f.request);
    assert.equal(f.rows[0].status, 'waiting');
    f.rows[0].inserted_at = '2000-01-01';
    const jwt = auth.sign({id: 9, type: 1, name: 'Admin'}, f.options.jwt_secret);
    f.request.cookie = () => jwt;
    const originalModel = f.comments.getModel;
    f.comments.getModel = name => name === 'user' ? {where() {return this},
      select: async() => [{id: 9, name: 'Admin', type: 1, status: 1, email: 'admin@example.test'}]} : originalModel(name);
    await f.comments.submit(7, {...body, comment: 'admin message', user_id: '1'}, f.request);
    assert.equal(f.rows[1].user_id, '9');
    assert.equal(f.rows[1].nick, 'Admin');
    const counts = [];
    const moderation = new Moderation({getModel: () => {
      let id;
      return {where(where) {id = where.id; return this}, setRelation() {return this},
        find: async() => ({...f.rows.find(row => row.id === id)}),
        update: async patch => Object.assign(f.rows.find(row => row.id === id), patch)};
    }, now: () => new Date().toISOString(), syncCount: async id => { counts.push(id) }});
    await moderation.moderate({id: 1, operation: 'approved'}, {id: 9, type: 1});
    assert.equal((await f.comments.list(7)).items.length, 1);
    assert.deepEqual(counts, [7]);
    await moderation.moderate({id: 1, operation: 'spam'}, {id: 9, type: 1});
    assert.equal((await f.comments.list(7)).items.length, 0);
  });

test('registered detail and comment routes respect visibility without changing native routes', async t => {
  const {SayService} = require('../lib/say-service');
  const routes = [];
  const hooks = [];
  const noop = () => {};
  t.mock.method(SayService.prototype, 'settings', async() => ({enabled: true, commentsEnabled: false}));
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
  t.mock.method(SayService.prototype, 'settings', async() => ({enabled: true, commentsEnabled: false}));
  get.mock.mockImplementation(async() => ({id: 7, pathname: 'example', status: 'public', allowComments: true, text: 'hello', tags: []}));
  t.mock.method(SayComments.prototype, 'configuration', async() => ({options: {}, public: {}}));
  await detail.handler({ctx: request, params: {id: '7'}, query: {}});
  assert.match(request.body, /client.init/);
  assert.doesNotMatch(request.body, /say-comment-form/);
  get.mock.mockImplementation(async() => ({id: 7, status: 'private'}));
  await assert.rejects(detail.handler({ctx: request, params: {id: '7'}, query: {}}), {status: 404});
});

test('rejects simultaneous submissions and removes a comment when target closes during save', async() => {
  const f = fixture();
  let release;
  f.captcha.verify = () => new Promise(resolve => { release = resolve });
  const first = f.comments.submit(7, body, f.request);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.comments.submit(7, body, f.request), {status: 429});
  release(true);
  await first;
  const other = fixture();
  const originalModel = other.comments.getModel;
  other.comments.getModel = name => {
    const model = originalModel(name);
    if (name === 'comment') {
      const add = model.add.bind(model);
      model.add = async row => { const id = await add(row); other.item.status = 'private'; return id };
    }
    return model;
  };
  await assert.rejects(other.comments.submit(7, body, other.request), {status: 404});
  assert.equal(other.rows.length, 0);
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

test('native comment filter retains Say switches and moderation without adding a public API', async() => {
  const Module = require('node:module');
  const original = Module._load;
  const f = fixture();
  let type = 3;
  f.comments.getModel = name => name === 'post'
    ? {where: () => ({field: () => ({find: async() => ({id: 7, type})})})} : f.getModel(name);
  try {
    Module._load = function(name, ...args) {
      if (name === 'firekylin/src/service/comment') return {resolveCommentPostId: async() => 7};
      return original.call(this, name, ...args);
    };
    const data = {url: '/says?pathname=example&type=3', status: 'approved'};
    assert.equal((await f.comments.beforeNativeCreate(data)).status, 'waiting');
    assert.equal((await f.comments.beforeNativeCreate({...data, status: 'spam'})).status, 'spam');
    f.item.allowComments = false;
    await assert.rejects(f.comments.beforeNativeCreate(data), {status: 403});
    type = 0;
    assert.equal(await f.comments.beforeNativeCreate(data), data);
  } finally { Module._load = original; }
});
