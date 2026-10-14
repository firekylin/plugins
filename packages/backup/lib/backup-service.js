'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const nodemailer = require('nodemailer');
const {Cron} = require('croner');
const {SqlDump} = require('./sql-dump');

const OPTION_CONFIG = 'plugin_backup_config';
const OPTION_LAST = 'plugin_backup_last';
const FILE_PATTERN = /^firekylin-\d{8}-\d{6}-\d{3}\.sql$/;
const DEFAULTS = {
  enabled: false,
  schedule: '0 3 * * *',
  timezone: 'UTC',
  destination: 'local',
  directory: 'data/backups',
  retention: 14,
  emailTo: '',
  emailFrom: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: ''
};

function parse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) } catch { return fallback }
}

function cleanConfig(value = {}, previous = {}) {
  const config = {...DEFAULTS, ...previous};
  config.enabled = value.enabled === true;
  config.schedule = String(value.schedule || config.schedule).trim().slice(0, 120);
  config.timezone = String(value.timezone || config.timezone).trim().slice(0, 80);
  config.destination = ['local', 'email', 'both'].includes(value.destination) ? value.destination : 'local';
  config.directory = String(value.directory || config.directory).trim().slice(0, 1024);
  config.retention = Math.max(1, Math.min(365, Math.trunc(Number(value.retention) || DEFAULTS.retention)));
  config.emailTo = String(value.emailTo || '').trim().slice(0, 1000);
  config.emailFrom = String(value.emailFrom || '').trim().slice(0, 320);
  config.smtpHost = String(value.smtpHost || '').trim().slice(0, 255);
  config.smtpPort = Math.max(1, Math.min(65535, Math.trunc(Number(value.smtpPort) || 587)));
  config.smtpSecure = value.smtpSecure === true;
  config.smtpUser = String(value.smtpUser || '').trim().slice(0, 255);
  config.smtpPassword = typeof value.smtpPassword === 'string' && value.smtpPassword
    ? value.smtpPassword.slice(0, 2048) : String(previous.smtpPassword || '');
  return config;
}

function stamp(date) {
  const part = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${part(date.getUTCMonth() + 1)}${part(date.getUTCDate())}-` +
    `${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}-` +
    String(date.getUTCMilliseconds()).padStart(3, '0');
}

class BackupService {
  constructor({getModel, database, projectPath, logger = console, now = () => new Date(), mailer = nodemailer,
    CronClass = Cron}) {
    this.getModel = getModel;
    this.database = database;
    this.projectPath = path.resolve(projectPath);
    this.logger = logger;
    this.now = now;
    this.mailer = mailer;
    this.CronClass = CronClass;
    this.job = null;
  }

  async options() { return this.getModel('options').getOptions(true) }

  async config() {
    const options = await this.options();
    return cleanConfig(parse(options[OPTION_CONFIG]));
  }

  async saveConfig(input) {
    const previous = await this.config();
    const config = cleanConfig(input, previous);
    new this.CronClass(config.schedule, {timezone: config.timezone, paused: true}, () => {});
    if (['email', 'both'].includes(config.destination) && (!config.emailTo || !config.emailFrom || !config.smtpHost)) {
      throw Object.assign(new Error('Email delivery requires recipient, sender and SMTP host'), {status: 400});
    }
    await this.getModel('options').updateOptions(OPTION_CONFIG, JSON.stringify(config));
    this.schedule(config);
    return config;
  }

  directory(config) {
    return path.resolve(this.projectPath, config.directory);
  }

  async list() {
    const config = await this.config();
    const directory = this.directory(config);
    let names = [];
    try { names = await fsp.readdir(directory) } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const files = await Promise.all(names.filter(name => FILE_PATTERN.test(name)).map(async name => {
      const info = await fsp.stat(path.join(directory, name));
      return {name, size: info.size, createdAt: info.mtime.toISOString(), mtime: info.mtimeMs};
    }));
    return files.sort((a, b) => b.mtime - a.mtime);
  }

  async last() {
    const options = await this.options();
    return parse(options[OPTION_LAST], null);
  }

  async remember(data) {
    await this.getModel('options').updateOptions(OPTION_LAST, JSON.stringify(data));
  }

  async acquireLock() {
    const directory = path.join(this.projectPath, 'data');
    const file = path.join(directory, '.firekylin-backup.lock');
    await fsp.mkdir(directory, {recursive: true});
    try {
      return {file, handle: await fsp.open(file, 'wx', 0o600)};
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await fsp.stat(file).catch(() => null);
      if (info && this.now().getTime() - info.mtimeMs > 12 * 60 * 60 * 1000) {
        await fsp.unlink(file).catch(() => {});
        return {file, handle: await fsp.open(file, 'wx', 0o600)};
      }
      throw Object.assign(new Error('Another backup is already running'), {code: 'BACKUP_RUNNING'});
    }
  }

  async email(file, config, filename) {
    const transport = this.mailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      ...(config.smtpUser ? {auth: {user: config.smtpUser, pass: config.smtpPassword}} : {})
    });
    await transport.sendMail({
      from: config.emailFrom,
      to: config.emailTo,
      subject: `Firekylin backup ${filename}`,
      text: `Firekylin SQL backup created at ${this.now().toISOString()}.`,
      attachments: [{filename, path: file}]
    });
    if (typeof transport.close === 'function') transport.close();
  }

  async prune(config) {
    if (!['local', 'both'].includes(config.destination)) return;
    const files = await this.list();
    await Promise.all(files.slice(config.retention).map(file =>
      fsp.unlink(path.join(this.directory(config), file.name))));
  }

  async run(trigger = 'manual') {
    const config = await this.config();
    const lock = await this.acquireLock();
    let file;
    try {
      await lock.handle.writeFile(JSON.stringify({pid: process.pid, startedAt: this.now().toISOString()}));
      const local = ['local', 'both'].includes(config.destination);
      const directory = local ? this.directory(config) : path.join(os.tmpdir(), 'firekylin-backups');
      await fsp.mkdir(directory, {recursive: true, mode: 0o700});
      const filename = `firekylin-${stamp(this.now())}.sql`;
      file = path.join(directory, filename);
      const partial = file + '.partial';
      const model = this.getModel('options');
      const writeDump = query => new SqlDump({
        query, type: this.database.type, prefix: this.database.prefix, now: this.now
      }).write(partial);
      const stats = typeof model.transaction === 'function' && typeof model.db === 'function'
        ? await model.transaction(async connection => {
          const query = sql => model.db().query({sql, debounce: false}, connection);
          if (this.database.type === 'postgresql') {
            await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
          }
          return writeDump(query);
        })
        : await writeDump(sql => model.query(sql));
      await fsp.chmod(partial, 0o600);
      await fsp.rename(partial, file);
      if (['email', 'both'].includes(config.destination)) await this.email(file, config, filename);
      await this.prune(config);
      const result = {ok: true, trigger, filename, ...stats, bytes: (await fsp.stat(file)).size,
        createdAt: this.now().toISOString(), destination: config.destination};
      await this.remember(result);
      if (!local) await fsp.unlink(file).catch(() => {});
      return result;
    } catch (error) {
      if (file) await fsp.unlink(file + '.partial').catch(() => {});
      if (file && config.destination === 'email') await fsp.unlink(file).catch(() => {});
      await this.remember({ok: false, trigger, error: error.message, createdAt: this.now().toISOString()}).catch(() => {});
      throw error;
    } finally {
      await lock.handle.close().catch(() => {});
      await fsp.unlink(lock.file).catch(() => {});
    }
  }

  schedule(config) {
    if (this.job) this.job.stop();
    this.job = null;
    if (!config.enabled) return;
    this.job = new this.CronClass(config.schedule, {timezone: config.timezone, protect: true}, async() => {
      try { await this.run('scheduled') } catch (error) {
        if (error.code !== 'BACKUP_RUNNING') this.logger.error?.(`[plugin:backup] ${error.stack || error.message}`);
      }
    });
  }

  async start() { this.schedule(await this.config()) }
  stop() { if (this.job) this.job.stop(); this.job = null }

  async download(name) {
    if (!FILE_PATTERN.test(name)) return null;
    const file = path.join(this.directory(await this.config()), name);
    try { await fsp.access(file); return file } catch { return null }
  }
}

module.exports = {BackupService, DEFAULTS, cleanConfig, stamp, FILE_PATTERN};
