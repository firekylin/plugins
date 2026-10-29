const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const {generate} = require('../lib/client');
const helpers = require('../../../test/helpers/ai-images');
const test = helpers ? nodeTest : nodeTest.skip;
const provider = 'grok';
const image = {mimeType: 'image/png', data: 'YWJj'};
function payload() {
  if (provider === 'google-gemini') return {candidates: [{content: {parts: [{inlineData: image}]}}]};
  if (provider === 'cloudflare') return {success: true, result: {image: image.data}};
  if (provider === 'qianwen') return {output: {choices: [{message: {content: [{image: 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/output.png'}]}}]}};
  if (provider === 'vercel-ai-gateway') return {choices: [{message: {images: [{image_url: {url: 'data:image/png;base64,YWJj'}}]}}]};
  return {data: [{b64_json: image.data}], usage: {total_tokens: 2}};
}
for (const edit of [false, true]) test(`image ${edit ? 'editing' : 'generation'} uses native protocol`, async() => {
  let sent, address; const controller = new AbortController();
  const result = await generate({images: helpers, apiKey: 'secret', accountId: 'a'.repeat(32), signal: controller.signal,
    request: {capability: 'image', model: 'image-model', messages: [{role: 'user', content: 'draw a cat'}], ...(edit ? {images: [image]} : {})},
    fetchImpl: async(url, options) => {
      assert.equal(options.signal, controller.signal);
      if (String(url).includes('output.png')) {
        assert.equal(options.headers, undefined); assert.equal(options.redirect, 'error');
        return new Response(Buffer.from('abc'), {headers: {'content-type': 'image/png'}});
      }
      sent = options; address = String(url);
      return {ok: true, json: async() => payload()};
    }});
  assert.equal(result.images[0].data, image.data);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  if (provider === 'openai') {
    assert.ok(address.endsWith(edit ? '/images/edits' : '/images/generations'));
    if (edit) {assert.equal(sent.body.get('image[]').type, image.mimeType); assert.equal(sent.headers['Content-Type'], undefined)}
    else assert.equal(JSON.parse(sent.body).n, 1);
  }
  if (provider === 'cloudflare') {assert.match(address, /ai\/run\/image-model$/); assert.equal(sent.body.has('input_image_0'), edit)}
  if (provider === 'grok') {assert.ok(address.endsWith(edit ? '/images/edits' : '/images/generations')); assert.equal(!!JSON.parse(sent.body).image, edit)}
  if (provider === 'doubao') assert.equal(!!JSON.parse(sent.body).image, edit);
  if (provider === 'qianwen') assert.equal(JSON.parse(sent.body).input.messages[0].content.some(c => c.image), edit);
  if (provider === 'google-gemini') assert.equal(JSON.parse(sent.body).contents[0].parts.some(p => p.inlineData), edit);
  if (provider === 'vercel-ai-gateway') {const body = JSON.parse(sent.body); assert.ok(body.modalities.includes('image')); assert.equal(body.messages[0].content.some(c => c.type === 'image_url'), edit)}
});
test('rejects malformed reference images before making requests', async() => {
  await assert.rejects(generate({images: helpers, apiKey: 'secret', accountId: 'a'.repeat(32), request: {capability: 'image', model: 'image-model', messages: [{role: 'user', content: 'cat'}], images: [{mimeType: 'text/html', data: 'YWJj'}]}, fetchImpl: () => {throw Error('must not fetch')}}), /Invalid image/);
});
test('rejects missing image output', async() => {
  await assert.rejects(generate({images: helpers, apiKey: 'secret', accountId: 'a'.repeat(32), request: {capability: 'image', model: 'image-model', messages: [{role: 'user', content: 'cat'}]}, fetchImpl: async() => ({ok: true, json: async() => ({})})}), /image/i);
});
test('testing an image model uses a text probe', async() => {
  let definition, action, probe;
  await require('../plugin').register({ai: {
    credentials: {get: async() => '', has: async() => true},
    registerProvider: d => {definition = d}, providers: async() => [],
    generate: async request => {probe = request; return {model: request.model}}
  }, admin: {registerForm() {}, registerAction: a => {action = a}}});
  const model = definition.models.find(m => m.capabilities.includes('image'));
  assert.ok(model);
  await action.handler({model: model.id});
  assert.ok(definition.models.find(m => m.id === probe.model).capabilities.includes('text'));
  assert.notEqual(probe.capability, 'image');
});

test('provider failures remain failures rather than empty successes', async() => {
  await assert.rejects(generate({images: helpers, apiKey: 'secret', accountId: 'a'.repeat(32), request: {capability: 'image', model: 'image-model', messages: [{role: 'user', content: 'cat'}]}, fetchImpl: async() => ({ok: false, status: 429, json: async() => ({})})}), /429/);
});

test('registered adapter forwards the core-owned image helpers', async t => {
  let definition;
  const previous = global.fetch;
  global.fetch = async url => {
    if (String(url).includes('output.png')) return new Response(Buffer.from('abc'), {headers: {'content-type': 'image/png'}});
    return {ok: true, json: async() => payload()};
  };
  t.after(() => {global.fetch = previous});
  await require('../plugin').register({ai: {
    credentials: {get: async key => key === 'accountId' ? 'a'.repeat(32) : key === 'apiKey' ? 'test' : '', has: async() => true},
    registerProvider: value => {definition = value}
  }, admin: {registerForm() {}, registerAction() {}}});
  const model = definition.models.find(m => m.capabilities.includes('image'));
  const result = await definition.generate({capability: 'image', model: model.id,
    messages: [{role: 'user', content: 'cat'}], images: [image]}, {images: helpers, reportUsage() {}});
  assert.equal(result.images[0].data, image.data);
});
