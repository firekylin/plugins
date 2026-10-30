'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, mkdir, writeFile, readFile, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const script = import('../.github/scripts/sync-registry.mjs');

const pkg = (name = 'example', version = '1.2.0') => ({
  name, version, firekylin: {type: 'plugin', id: name},
});
const manifest = (name, version) => ({
  ...pkg(name, version), description: 'Published description',
  firekylin: {type: 'plugin', id: name, permissions: ['network:example']},
  engines: {node: '>=22'}, dist: {integrity: 'sha512-example'},
});
const metadata = (name, versions) => ({name, versions: Object.fromEntries(
  versions.map(version => [version, manifest(name, version)]),
)});
const registry = {schemaVersion: 1, packages: [{
  type: 'plugin', name: 'example', version: '1.1.0', title: '自定义标题', custom: true,
}]};

test('uses published metadata, preserves curated fields, and is idempotent', async() => {
  const {syncRegistry} = await script;
  const lookup = async name => metadata(name, ['1.1.0', '1.2.0']);
  const result = await syncRegistry(registry, [pkg()], lookup);
  assert.equal(result.packages[0].version, '1.2.0');
  assert.equal(result.packages[0].title, '自定义标题');
  assert.equal(result.packages[0].custom, true);
  assert.equal(result.packages[0].description, 'Published description');
  assert.deepEqual(result.packages[0].permissions, ['network:example']);
  assert.deepEqual(result.packages[0].engines, {node: '>=22'});
  assert.equal(registry.packages[0].version, '1.1.0');
  assert.deepEqual(await syncRegistry(result, [pkg()], lookup), result);
});

test('partial publication updates successful packages only', async() => {
  const {syncRegistry} = await script;
  const input = {schemaVersion: 1, packages: [
    ...registry.packages, {...registry.packages[0], name: 'failed'},
  ]};
  const result = await syncRegistry(input, [pkg(), pkg('failed')], async name =>
    metadata(name, name === 'failed' ? ['1.1.0'] : ['1.1.0', '1.2.0']));
  assert.equal(result.packages[0].version, '1.2.0');
  assert.deepEqual(result.packages[1], input.packages[1]);
});

test('selects latest published stable version bounded by main, with numeric ordering', async() => {
  const {syncRegistry} = await script;
  const result = await syncRegistry(registry, [pkg('example', '1.11.0')], async name =>
    metadata(name, ['1.9.0', '1.10.0', '1.11.0-beta.1', '2.0.0']));
  assert.equal(result.packages[0].version, '1.10.0');
});

test('never downgrades, adds unpublished packages, or includes private/prerelease packages', async() => {
  const {syncRegistry} = await script;
  assert.deepEqual(await syncRegistry(registry, [pkg('example', '1.0.0')], async name =>
    metadata(name, ['1.0.0'])), registry);
  assert.deepEqual(await syncRegistry(registry, [pkg('missing')], async() => null), registry);
  const noLookup = async() => { throw new Error('must not query'); };
  assert.deepEqual(await syncRegistry(registry, [
    {...pkg(), private: true}, pkg('example', '2.0.0-beta.1'), {...pkg(), firekylin: {}},
  ], noLookup), registry);
});

test('adds newly published plugins without dropping existing entries', async() => {
  const {syncRegistry} = await script;
  const result = await syncRegistry(registry, [pkg('new')], async name => metadata(name, ['1.2.0']));
  assert.deepEqual(result.packages[0], registry.packages[0]);
  assert.equal(result.packages[1].name, 'new');
  assert.equal(result.packages[1].title, 'new');
});

test('rejects mismatched published manifests', async() => {
  const {syncRegistry} = await script;
  await assert.rejects(syncRegistry(registry, [pkg()], async() => ({
    versions: {'1.2.0': manifest('wrong-name', '1.2.0')},
  })), /Invalid published manifest/);
});

test('npm lookup distinguishes missing packages from errors and retries failures', async() => {
  const {fetchPublished} = await script;
  assert.equal(await fetchPublished('missing', async() => ({status: 404})), null);
  let calls = 0;
  const data = metadata('example', ['1.2.0']);
  assert.deepEqual(await fetchPublished('example', async url => {
    assert.equal(url, 'https://registry.npmjs.org/example');
    if (++calls === 1) return {ok: false, status: 503};
    return {ok: true, json: async() => data};
  }), data);
  assert.equal(calls, 2);
  await assert.rejects(fetchPublished('example', async() => ({ok: false, status: 403})), /HTTP 403/);
});

test('failed reconciliation leaves registry file unchanged', async() => {
  const {main} = await script;
  const root = await mkdtemp(join(tmpdir(), 'registry-test-'));
  const originalFetch = global.fetch;
  try {
    await mkdir(join(root, 'packages', 'example'), {recursive: true});
    await writeFile(join(root, 'packages', 'example', 'package.json'), JSON.stringify(pkg()));
    const original = JSON.stringify(registry);
    await writeFile(join(root, 'registry.json'), original);
    global.fetch = async() => ({ok: true, json: async() => ({
      ...metadata('example', ['1.2.0']), versions: {'1.2.0': manifest('wrong', '1.2.0')},
    })});
    await assert.rejects(main(root), /Invalid published manifest/);
    assert.equal(await readFile(join(root, 'registry.json'), 'utf8'), original);
  } finally {
    global.fetch = originalFetch;
    await rm(root, {recursive: true, force: true});
  }
});
