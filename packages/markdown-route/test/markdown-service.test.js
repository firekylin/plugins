'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {MarkdownService, protectedPost} = require('../lib/markdown-service');

function service(row) {
  let where;
  const model = {
    where(value) { where = value; return this },
    field() { return this },
    setRelation(value) { assert.equal(value, false); return this },
    async find() { return row }
  };
  return {
    instance: new MarkdownService({getModel: name => {
      assert.equal(name, 'post');
      return model;
    }, now: () => '2026-10-15 12:00:00'}),
    where: () => where
  };
}

test('returns the original Markdown for a public published article', async() => {
  const subject = service({id: 1, pathname: 'hello', markdown_content: '# Hello\n', options: '{}'});
  assert.equal(await subject.instance.find('hello'), '# Hello\n');
  assert.deepEqual(subject.where(), {
    pathname: 'hello', type: 0, status: 3, is_public: 1,
    create_time: {'<=': '2026-10-15 12:00:00'}
  });
});

test('does not expose missing or password-protected articles', async() => {
  assert.equal(await service({}).instance.find('missing'), null);
  assert.equal(await service({id: 2, markdown_content: 'secret',
    options: JSON.stringify({postPasswordHash: 'hash'})}).instance.find('protected'), null);
  assert.equal(protectedPost({postPasswordHash: 'hash'}), true);
});

test('preserves an intentionally empty Markdown document', async() => {
  assert.equal(await service({id: 3, markdown_content: null, options: {}}).instance.find('empty'), '');
});
