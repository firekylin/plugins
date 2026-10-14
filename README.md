# Firekylin Plugins

This repository is a pnpm monorepo for Firekylin plugins. Each plugin should
live in its own package under `packages/`, for example `packages/example-plugin`.

Create a `package.json` in each plugin directory and add that package's
dependencies, scripts, and Firekylin plugin entry point there. Install
dependencies from the repository root with `pnpm install`; pnpm discovers
packages through `pnpm-workspace.yaml`.

## Available plugins

- [`@firekylin/plugin-backup`](packages/backup): create manual or scheduled SQL backups and save them locally, send them by email, or both.
