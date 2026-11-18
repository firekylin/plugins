'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Compatibility only: never invoked after a modern host upload fails.
async function legacyUpload(buffer, {filename, mime, userId}, dependencies = {}) {
  const options = dependencies.getOptions ? await dependencies.getOptions() : await think.model('options').getOptions();
  const config = options && options.upload;
  if (!config || !config.type) throw new Error('Firekylin upload provider is not configured');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'firekylin-say-'));
  const localPath = path.join(temporary, `${Date.now()}-${filename}`);
  try {
    await fs.writeFile(localPath, buffer, {flag: 'wx', mode: 0o600});
    const file = {name: filename, path: localPath, size: buffer.length, type: mime};
    const uploadConfig = {...config, name: path.parse(filename).name, file};
    const uploadMedia = dependencies.uploadMedia || global.firekylin?.uploadMedia;
    if (typeof uploadMedia === 'function') {
      const result = await uploadMedia({file, config: uploadConfig, userId});
      return result.url;
    }
    // Older cores do not expose media registration. Preserve their existing
    // upload behavior, but explicitly report the reduced capability.
    const warn = dependencies.warn || (message => think.logger.warn(message));
    warn('Say: legacy Firekylin upload; media registration unavailable. Upgrade core for media management.');
    const sdk = ['r2', 'minio', 'backblaze', 'wasabi', 'digitalocean', 'vercel'].includes(config.type);
    const uploader = dependencies.getUploader
      ? dependencies.getUploader(sdk ? 'files-sdk' : config.type)
      : think.service(`upload/${sdk ? 'files-sdk' : config.type}`);
    return await uploader.run(localPath, uploadConfig);
  } finally {
    await fs.rm(temporary, {recursive: true, force: true});
  }
}

module.exports = {legacyUpload};
