import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [before, after = 'HEAD'] = process.argv.slice(2);

if (!before) {
  throw new Error('Usage: node changed-packages.mjs <before> [after]');
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }

  return result.stdout;
}

const packageJsonPaths = git('diff', '--name-only', before, after, '--', 'packages/*/package.json')
  .split('\n')
  .filter((path) => /^packages\/[^/]+\/package\.json$/.test(path));

const packages = [];

for (const path of packageJsonPaths) {
  if (!existsSync(path)) {
    continue;
  }

  const current = JSON.parse(readFileSync(path, 'utf8'));
  let previousVersion;

  const previous = spawnSync('git', ['show', `${before}:${path}`], { encoding: 'utf8' });
  if (previous.status === 0) {
    previousVersion = JSON.parse(previous.stdout).version;
  }

  if (current.version && current.version !== previousVersion && !current.private) {
    packages.push({
      directory: path.slice(0, -'/package.json'.length),
      name: current.name,
      version: current.version,
    });
  }
}

process.stdout.write(JSON.stringify(packages));
