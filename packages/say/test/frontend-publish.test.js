'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {FrontendPublish, renderComposer} = require('../lib/frontend-publish');
const {renderSayPage} = require('../lib/render');
function setup() {
  const f = {session: {id: 7, type: 1}, user: {id: 7, type: 1, status: 1}, enabled: true, writes: []};
  f.request = {state: {}, protocol: 'https', host: 'blog.test', is: () => true,
    get: name => name === 'origin' ? 'https://blog.test' : 'proof',
    throw: status => { throw Object.assign(new Error('rejected'), {status}) }};
  f.publisher = new FrontendPublish({getModel: name => name === 'options' ? {getOptions: async() => ({jwt_secret: 'secret'})}
    : {where: () => ({find: async() => f.user})}, getService: () => ({currentUser: () => f.session, csrfToken: () => 'proof'}),
    say: {settings: async() => ({enabled: f.enabled}), create: async(input, author) => { f.writes.push({input, author}); return {id: 9} }}});
  return f;
}
test('renders only login for guests, nothing for other accounts and composer for admins', () => {
  assert.match(renderComposer({loggedIn: false}, true), /\/admin\/login\?redirect=%2Fsays/);
  assert.equal(renderComposer({loggedIn: true, canPublish: false}, true), '');
  assert.match(renderComposer({loggedIn: false}, true), />登录<\/a>/);
  assert.equal(renderComposer({loggedIn: false}, false), '');
  const composer = renderComposer({loggedIn: true, canPublish: true, csrf: '"><evil>'}, true);
  assert.doesNotMatch(composer, /<evil>/);
  const html = renderSayPage({items: [{id: 1, text: 'existing post', tags: []}], page: 1, pageSize: 10, total: 1}, {composer});
  assert.ok(html.indexOf('say-publish-form') < html.indexOf('existing post'));
  const source = composer.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new (require('node:vm').Script)(source));
});
test('publishes only text under authenticated author, ignoring forged fields', async() => {
  const f = setup();
  assert.deepEqual(await f.publisher.submit(f.request, {text: 'hello #tag', user_id: 1, kind: 'image', status: 'private', allowComments: true}), {success: true, id: 9});
  assert.deepEqual(f.writes, [{author: 7, input: {kind: 'text', status: 'public', text: 'hello #tag', source: 'Firekylin', allowComments: false}}]);
});
test('denies missing, banned, demoted and non-admin accounts, disabled publishing and invalid requests', async() => {
  for (const change of [f => { f.session = null }, f => { f.user = {} }, f => { f.user.status = 0 },
    f => { f.user.type = 2 }, f => { f.session.type = 4 }, f => { f.enabled = false },
    f => { f.request.get = () => 'evil' }, f => { f.request.is = () => false },
    f => { f.request.get = name => name === 'origin' ? 'https://blog.test' : 'bad-proof' }]) {
    const f = setup(); change(f);
    await assert.rejects(f.publisher.submit(f.request, {text: 'hello'}), {status: 403});
    assert.equal(f.writes.length, 0);
  }
  for (const text of ['', '  ', 'a'.repeat(20001), 12]) {
    const f = setup();
    await assert.rejects(f.publisher.submit(f.request, {text}), {status: 400});
  }
});
test('verifies host JWT and CSRF proof with real core auth', {skip: !process.env.FIREKYLIN_CORE_PATH}, async() => {
  const auth = require(require('node:path').join(process.env.FIREKYLIN_CORE_PATH, 'src/service/admin-auth'));
  const f = setup();
  f.request.state.jwtSecret = 'a'.repeat(64);
  f.request.cookie = () => auth.sign({id: 7, type: 1, name: 'admin'}, f.request.state.jwtSecret);
  f.publisher.getService = () => auth;
  f.request.get = name => name === 'origin' ? 'https://blog.test' : auth.csrfToken(f.request);
  await f.publisher.submit(f.request, {text: 'hello'});
  assert.equal(f.writes[0].author, 7);
  f.request.cookie = () => 'forged';
  await assert.rejects(f.publisher.submit(f.request, {text: 'hello'}), {status: 403});
});
