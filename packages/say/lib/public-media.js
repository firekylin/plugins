'use strict';

const https = require('node:https');
const dns = require('node:dns/promises');
const {BlockList, isIP} = require('node:net');

const deniedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['168.63.129.16', 32], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) {
  deniedV4.addSubnet(address, prefix);
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  deniedV6.addSubnet(address, prefix, 'ipv6');
}

function mediaError(code = 'QQ_DOWNLOAD_FAILED', httpStatus) {
  return Object.assign(new Error('QQ media download failed'), {code, httpStatus});
}

function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !deniedV4.check(address) : family === 6 &&
    globalV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
}

function mediaUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw mediaError('QQ_MEDIA_URL_DENIED');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      (isIP(hostname) && !isPublicAddress(hostname))) {
    throw mediaError('QQ_MEDIA_URL_DENIED');
  }
  return url;
}

async function downloadPublicMedia(value, {
  lookup = dns.lookup,
  request = https.request,
  timeout = 15000,
  limit = 20 * 1024 * 1024
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const {signal} = controller;
  function bounded(promise) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(mediaError());
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, {once: true});
      Promise.resolve(promise).then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', abort);
      });
    });
  }
  try {
    let url = mediaUrl(value);
    for (let hop = 0; hop <= 3; hop++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const family = isIP(hostname);
      const addresses = family ? [{address: hostname, family}] :
        await bounded(lookup(hostname, {all: true, verbatim: true}));
      if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
        throw mediaError('QQ_MEDIA_URL_DENIED');
      }
      // Pin DNS results to this connection; do not resolve again after validation.
      const response = await bounded(new Promise((resolve, reject) => {
        const req = request(url, {
          agent: false,
          signal,
          lookup(name, options, callback) {
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          }
        }, resolve);
        req.on('error', reject);
        req.end();
      }));
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        if (hop === 3 || !response.headers.location) throw mediaError();
        url = mediaUrl(new URL(response.headers.location, url).href);
        continue;
      }
      try {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw mediaError('QQ_DOWNLOAD_FAILED', response.statusCode);
        }
        if (Number(response.headers['content-length']) > limit) throw mediaError('MEDIA_SIZE_INVALID');
        const chunks = [];
        let size = 0;
        await bounded((async() => {
          for await (const chunk of response) {
            size += chunk.length;
            if (size > limit) throw mediaError('MEDIA_SIZE_INVALID');
            chunks.push(Buffer.from(chunk));
          }
        })());
        return {buffer: Buffer.concat(chunks), mime: response.headers['content-type']};
      } finally {
        response.destroy();
      }
    }
  } catch (error) {
    if (['QQ_MEDIA_URL_DENIED', 'QQ_DOWNLOAD_FAILED', 'MEDIA_SIZE_INVALID'].includes(error.code)) throw error;
    throw mediaError();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

module.exports = {downloadPublicMedia, mediaUrl, isPublicAddress};
