# Firekylin Backup

Creates manual and scheduled SQL backups from the Firekylin admin panel. Backups can be retained on local storage, delivered as email attachments through SMTP, or both.

Supported database adapters:

- SQLite
- MySQL and TiDB
- PostgreSQL

## Install

Add the package to the Firekylin site project and restart Firekylin:

```sh
pnpm add firekylin-plugin-backup
```

Open **备份 → 数据库备份** in the admin sidebar. Save the settings, then run one manual backup and test restoring it before enabling the schedule.

The schedule uses standard five-field Cron syntax and an IANA timezone. `0 3 * * *` runs every day at 03:00. A relative local directory is resolved from the Firekylin project directory. Backup files are created with mode `0600`, incomplete files use a `.partial` suffix, and retention cleanup only removes files created by this plugin.

Each dump runs inside one database transaction for a consistent snapshot. Scheduled jobs require a continuously running Firekylin process; timers and local files are not durable on serverless runtimes such as Vercel, so use email delivery and an external scheduler or a persistent deployment there.

Email delivery requires an SMTP host, sender, and recipient. SMTP passwords are stored in the Firekylin options table and are never returned to the browser after saving.

## Restore

Stop writes to the site, create a safety copy of the current database, and restore the SQL file using the matching database engine. The dump contains `DROP TABLE`, table definitions, and data inserts. Restore into the same database family used to create the backup.

The plugin backs up the database. Local media files, themes, project configuration, environment variables, and external object storage are outside the SQL dump and must be backed up separately.
