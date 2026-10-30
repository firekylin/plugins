import { readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Marketplace entries track stable releases, never prereleases or dist-tags.
function stableVersion(version) {
  return typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

function compare(a, b) {
  const left = a.split('.').map(BigInt);
  const right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export async function fetchPublished(name, fetchImpl = fetch) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`npm returned HTTP ${response.status} for ${name}`);
      const data = await response.json();
      if (data.name !== name || !data.versions || typeof data.versions !== 'object') {
        throw new Error(`Invalid npm metadata for ${name}`);
      }
      return data;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

export async function syncRegistry(registry, packages, lookup = fetchPublished) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.packages)) {
    throw new Error('Unsupported registry schema');
  }
  const result = structuredClone(registry);
  for (const pkg of packages) {
    if (pkg.private || pkg.firekylin?.type !== 'plugin' || !stableVersion(pkg.version)) continue;
    const index = result.packages.findIndex(entry => entry.name === pkg.name);
    const previous = result.packages[index];
    const published = await lookup(pkg.name);
    if (!published) continue;
    // A newer main commit may already be awaiting publication. Keep the newest
    // successful release at or below main, rather than trusting package.json.
    const version = Object.keys(published.versions)
      .filter(version => stableVersion(version) && compare(version, pkg.version) <= 0)
      .sort(compare).at(-1);
    if (!version) continue;
    if (previous && (!stableVersion(previous.version) || compare(version, previous.version) <= 0)) continue;
    const manifest = published.versions[version];
    if (manifest.name !== pkg.name || manifest.version !== version ||
        manifest.firekylin?.type !== 'plugin' || !manifest.firekylin.id || !manifest.dist?.integrity) {
      throw new Error(`Invalid published manifest for ${pkg.name}@${version}`);
    }
    const entry = {
      ...previous,
      type: 'plugin',
      name: pkg.name,
      version,
      title: previous?.title ?? manifest.firekylin.title ?? pkg.name,
      description: manifest.description ?? '',
      permissions: manifest.firekylin.permissions ?? [],
      engines: manifest.engines ?? {},
      firekylin: { type: 'plugin', id: manifest.firekylin.id },
    };
    if (index === -1) result.packages.push(entry);
    else result.packages[index] = entry;
  }
  return result;
}

export async function main(root = process.cwd()) {
  const path = resolve(root, 'registry.json');
  const original = await readFile(path, 'utf8');
  const packages = [];
  for (const entry of (await readdir(resolve(root, 'packages'), { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    try {
      packages.push(JSON.parse(await readFile(resolve(root, 'packages', entry.name, 'package.json'), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const result = await syncRegistry(JSON.parse(original), packages);
  const updated = `${JSON.stringify(result, null, 2)}\n`;
  if (original === updated) return;
  // No partial file is written if any npm lookup/validation fails.
  await writeFile(`${path}.tmp`, updated);
  await rename(`${path}.tmp`, path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
