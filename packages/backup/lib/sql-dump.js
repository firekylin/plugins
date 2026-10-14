'use strict';

const fs = require('node:fs/promises');

function rows(result) {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0]) && Array.isArray(result[1])) return result[0];
  return result;
}

function identifier(type, value) {
  const quote = ['mysql', 'tidb'].includes(type) ? '`' : '"';
  return quote + String(value).replaceAll(quote, quote + quote) + quote;
}

function literal(value, type) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) {
    const hex = value.toString('hex');
    if (type === 'postgresql') return `decode('${hex}', 'hex')`;
    return `X'${hex}'`;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) value = value.toISOString();
  if (typeof value === 'object') value = JSON.stringify(value);
  value = String(value);
  if (value.includes('\0')) {
    const hex = Buffer.from(value).toString('hex');
    if (type === 'postgresql') return `convert_from(decode('${hex}', 'hex'), 'UTF8')`;
    if (['mysql', 'tidb'].includes(type)) return `CONVERT(X'${hex}' USING utf8mb4)`;
    return `CAST(X'${hex}' AS TEXT)`;
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function postgresType(column) {
  if (/^nextval\(/i.test(column.column_default || '')) {
    return column.udt_name === 'int8' ? 'BIGSERIAL' : 'SERIAL';
  }
  const types = {
    int2: 'SMALLINT', int4: 'INTEGER', int8: 'BIGINT', float4: 'REAL', float8: 'DOUBLE PRECISION',
    numeric: column.numeric_precision ? `NUMERIC(${column.numeric_precision},${column.numeric_scale || 0})` : 'NUMERIC',
    varchar: column.character_maximum_length ? `VARCHAR(${column.character_maximum_length})` : 'VARCHAR',
    bpchar: column.character_maximum_length ? `CHAR(${column.character_maximum_length})` : 'CHAR',
    text: 'TEXT', bool: 'BOOLEAN', timestamp: 'TIMESTAMP', timestamptz: 'TIMESTAMP WITH TIME ZONE',
    date: 'DATE', time: 'TIME', json: 'JSON', jsonb: 'JSONB', bytea: 'BYTEA', uuid: 'UUID'
  };
  return types[column.udt_name] || String(column.data_type).toUpperCase();
}

class SqlDump {
  constructor({query, type, prefix = '', now = () => new Date()}) {
    if (typeof query !== 'function') throw new TypeError('query is required');
    if (!['sqlite', 'mysql', 'tidb', 'postgresql'].includes(type)) throw new Error(`Unsupported database: ${type}`);
    this.query = query;
    this.type = type;
    this.prefix = String(prefix || '');
    this.now = now;
  }

  async tables() {
    let names;
    if (this.type === 'sqlite') {
      names = rows(await this.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
        .map(row => row.name);
    } else if (['mysql', 'tidb'].includes(this.type)) {
      names = rows(await this.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'"))
        .map(row => Object.values(row)[0]);
    } else {
      names = rows(await this.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
        .map(row => row.tablename);
    }
    return names.filter(name => !this.prefix || String(name).startsWith(this.prefix)).sort();
  }

  async postgresSchema(table) {
    const name = sqlString(table);
    const columns = rows(await this.query(`SELECT column_name,data_type,udt_name,character_maximum_length,` +
      `numeric_precision,numeric_scale,is_nullable,column_default FROM information_schema.columns ` +
      `WHERE table_schema='public' AND table_name=${name} ORDER BY ordinal_position`));
    const constraints = rows(await this.query(`SELECT tc.constraint_name,tc.constraint_type,kcu.column_name,` +
      `kcu.ordinal_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ` +
      `ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema ` +
      `WHERE tc.table_schema='public' AND tc.table_name=${name} AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE') ` +
      `ORDER BY tc.constraint_name,kcu.ordinal_position`));
    const grouped = new Map();
    for (const item of constraints) {
      if (!grouped.has(item.constraint_name)) grouped.set(item.constraint_name, {type: item.constraint_type, columns: []});
      grouped.get(item.constraint_name).columns.push(identifier(this.type, item.column_name));
    }
    const definitions = columns.map(column => {
      const serial = /^nextval\(/i.test(column.column_default || '');
      return `${identifier(this.type, column.column_name)} ${postgresType(column)}` +
        (column.is_nullable === 'NO' ? ' NOT NULL' : '') +
        (!serial && column.column_default !== null ? ` DEFAULT ${column.column_default}` : '');
    });
    for (const [nameValue, constraint] of grouped) {
      definitions.push(`CONSTRAINT ${identifier(this.type, nameValue)} ${constraint.type} (${constraint.columns.join(', ')})`);
    }
    const schema = `CREATE TABLE ${identifier(this.type, table)} (\n  ${definitions.join(',\n  ')}\n);`;
    const constraintNames = new Set(grouped.keys());
    const indexes = rows(await this.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ` +
      `AND tablename=${name}`)).filter(index => !constraintNames.has(index.indexname)).map(index => index.indexdef + ';');
    return [schema, ...indexes].join('\n');
  }

  async schema(table) {
    if (this.type === 'sqlite') {
      const result = rows(await this.query(`SELECT type,name,sql FROM sqlite_master WHERE tbl_name=${sqlString(table)} ` +
        `AND type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC,name`));
      return result.map(item => item.sql.trim().replace(/;$/, '') + ';').join('\n');
    }
    if (['mysql', 'tidb'].includes(this.type)) {
      const result = rows(await this.query(`SHOW CREATE TABLE ${identifier(this.type, table)}`))[0] || {};
      const create = result['Create Table'] || result['Create View'] || Object.values(result)[1];
      if (!create) throw new Error(`Unable to read schema for ${table}`);
      return create.trim().replace(/;$/, '') + ';';
    }
    return this.postgresSchema(table);
  }

  async write(file) {
    await fs.writeFile(file, `-- Firekylin SQL backup\n-- Created: ${this.now().toISOString()}\n-- Database: ${this.type}\n\n`);
    const tableNames = await this.tables();
    if (['mysql', 'tidb'].includes(this.type)) await fs.appendFile(file, 'SET FOREIGN_KEY_CHECKS=0;\n\n');
    if (this.type === 'sqlite') await fs.appendFile(file, 'PRAGMA foreign_keys=OFF;\nBEGIN;\n\n');
    if (this.type === 'postgresql') await fs.appendFile(file, "SET client_encoding = 'UTF8';\nBEGIN;\n\n");
    let records = 0;
    for (const table of tableNames) {
      const quoted = identifier(this.type, table);
      await fs.appendFile(file, `DROP TABLE IF EXISTS ${quoted};\n${await this.schema(table)}\n\n`);
      let offset = 0;
      while (true) {
        const batch = rows(await this.query(`SELECT * FROM ${quoted} LIMIT 1000 OFFSET ${offset}`));
        if (!batch.length) break;
        const columns = Object.keys(batch[0]);
        const names = columns.map(column => identifier(this.type, column)).join(', ');
        const values = batch.map(row => '(' + columns.map(column => literal(row[column], this.type)).join(', ') + ')');
        await fs.appendFile(file, `INSERT INTO ${quoted} (${names}) VALUES\n${values.join(',\n')};\n`);
        records += batch.length;
        offset += batch.length;
        if (batch.length < 1000) break;
      }
      await fs.appendFile(file, '\n');
    }
    if (['mysql', 'tidb'].includes(this.type)) await fs.appendFile(file, 'SET FOREIGN_KEY_CHECKS=1;\n');
    if (this.type === 'sqlite') await fs.appendFile(file, 'COMMIT;\nPRAGMA foreign_keys=ON;\n');
    if (this.type === 'postgresql') await fs.appendFile(file, 'COMMIT;\n');
    return {tables: tableNames.length, records};
  }
}

module.exports = {SqlDump, identifier, literal, rows, postgresType};
