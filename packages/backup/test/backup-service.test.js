'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {BackupService, cleanConfig, stamp} = require('../lib/backup-service');

class FakeCron {
  constructor(pattern, options, handler) {
    if (pattern === 'invalid') throw new Error('Invalid cron pattern');
    this.pattern = pattern; this.options = options; this.handler = handler; this.stopped = false;
  }
  stop() { this.stopped = true }
}

function models(config = {}, transactional = false) {
  const values = {plugin_backup_config: JSON.stringify(config)};
  let transactions = 0;
  const query = async sql => {
    if (sql.includes("type='table' AND name NOT")) return [{name: 'fk_options'}];
    if (sql.includes("tbl_name='fk_options'")) return [{type: 'table', name: 'fk_options',
      sql: 'CREATE TABLE "fk_options" ("key" TEXT, "value" TEXT)'}];
    if (sql.startsWith('SELECT *')) return [{key: 'title', value: 'Blog'}];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const model = {
    async getOptions() { return {...values} },
    async updateOptions(key, value) { values[key] = value },
    query
  };
  if (transactional) {
    model.transaction = async handler => { transactions += 1; return handler({transaction: true}) };
    model.db = () => ({query: (options, connection) => {
      assert.equal(connection.transaction, true);
      assert.equal(options.debounce, false);
      return query(options.sql);
    }});
  }
  return {values, getModel: () => model, transactions: () => transactions};
}

test('creates a local backup, records its result and exposes it for download', async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-service-'));
  t.after(() => fs.rm(project, {recursive: true, force: true}));
  const db = models({destination: 'local', directory: 'backups', retention: 2}, true);
  const service = new BackupService({getModel: db.getModel, database: {type: 'sqlite', prefix: 'fk_'},
    projectPath: project, now: () => new Date('2026-10-14T03:04:05.006Z'), CronClass: FakeCron});
  const result = await service.run();
  assert.equal(result.filename, 'firekylin-20261014-030405-006.sql');
  assert.equal(result.tables, 1);
  assert.equal(db.transactions(), 1);
  assert.equal((await service.list()).length, 1);
  assert.equal(await service.download(result.filename), path.join(project, 'backups', result.filename));
  assert.equal((await service.last()).ok, true);
  assert.equal((await fs.stat(path.join(project, 'backups', result.filename))).mode & 0o777, 0o600);
});

test('sends an email-only backup and removes its temporary file', async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-email-'));
  t.after(() => fs.rm(project, {recursive: true, force: true}));
  const db = models({destination: 'email', emailTo: 'owner@example.test', emailFrom: 'backup@example.test',
    smtpHost: 'smtp.example.test'});
  let sent;
  const mailer = {createTransport: options => ({
    async sendMail(message) { sent = {options, message}; await fs.access(message.attachments[0].path) }, close() {}
  })};
  const service = new BackupService({getModel: db.getModel, database: {type: 'sqlite', prefix: 'fk_'},
    projectPath: project, mailer, now: () => new Date('2026-10-14T00:00:00Z'), CronClass: FakeCron});
  const result = await service.run();
  assert.equal(sent.message.to, 'owner@example.test');
  await assert.rejects(fs.access(path.join(os.tmpdir(), 'firekylin-backups', result.filename)));
});

test('preserves an existing SMTP password and validates schedules', async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-config-'));
  t.after(() => fs.rm(project, {recursive: true, force: true}));
  const db = models({smtpPassword: 'secret'});
  const service = new BackupService({getModel: db.getModel, database: {type: 'sqlite'}, projectPath: project,
    CronClass: FakeCron});
  const saved = await service.saveConfig({enabled: true, schedule: '0 2 * * *', timezone: 'UTC',
    destination: 'local', directory: 'backups', retention: 3, smtpPassword: ''});
  assert.equal(saved.smtpPassword, 'secret');
  assert.equal(service.job.pattern, '0 2 * * *');
  await assert.rejects(service.saveConfig({...saved, schedule: 'invalid'}), /Invalid cron/);
  service.stop();
});

test('normalizes limits and UTC filenames', () => {
  assert.equal(cleanConfig({retention: 999}).retention, 365);
  assert.equal(stamp(new Date('2026-01-02T03:04:05.006Z')), '20260102-030405-006');
});
