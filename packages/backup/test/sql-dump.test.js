'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {SqlDump, literal, postgresType} = require('../lib/sql-dump');

test('writes a restorable SQLite schema and escaped data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-sqlite-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'backup.sql');
  const query = async sql => {
    if (sql.includes("type='table' AND name NOT")) return [{name: 'fk_post'}, {name: 'other'}];
    if (sql.includes("tbl_name='fk_post'")) return [
      {type: 'table', name: 'fk_post', sql: 'CREATE TABLE "fk_post" ("id" INTEGER PRIMARY KEY, "title" TEXT)'},
      {type: 'index', name: 'fk_post_title', sql: 'CREATE INDEX "fk_post_title" ON "fk_post" ("title")'}
    ];
    if (sql.startsWith('SELECT * FROM "fk_post"')) return [{id: 1, title: "Firekylin's backup"}];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const result = await new SqlDump({query, type: 'sqlite', prefix: 'fk_',
    now: () => new Date('2026-10-14T00:00:00Z')}).write(file);
  assert.deepEqual(result, {tables: 1, records: 1});
  const sql = await fs.readFile(file, 'utf8');
  assert.match(sql, /CREATE TABLE "fk_post"/);
  assert.match(sql, /CREATE INDEX "fk_post_title"/);
  assert.match(sql, /'Firekylin''s backup'/);
  assert.doesNotMatch(sql, /other/);
});

test('reads MySQL create statements and serializes binary values', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-mysql-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'backup.sql');
  const query = async sql => {
    if (sql.startsWith('SHOW FULL TABLES')) return [{Tables_in_blog: 'fk_options', Table_type: 'BASE TABLE'}];
    if (sql.startsWith('SHOW CREATE TABLE')) return [{Table: 'fk_options',
      'Create Table': 'CREATE TABLE `fk_options` (`key` varchar(255), `value` blob)'}];
    if (sql.startsWith('SELECT *')) return [{key: 'logo', value: Buffer.from([0, 255])}];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  await new SqlDump({query, type: 'mysql', prefix: 'fk_'}).write(file);
  const sql = await fs.readFile(file, 'utf8');
  assert.match(sql, /SET FOREIGN_KEY_CHECKS=0/);
  assert.match(sql, /X'00ff'/);
});

test('maps PostgreSQL serial and common field types', () => {
  assert.equal(postgresType({udt_name: 'int4', column_default: "nextval('fk_post_id_seq'::regclass)"}), 'SERIAL');
  assert.equal(postgresType({udt_name: 'varchar', character_maximum_length: 191}), 'VARCHAR(191)');
  assert.equal(literal("a'b", 'postgresql'), "'a''b'");
});
