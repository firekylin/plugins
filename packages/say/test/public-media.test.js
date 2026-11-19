'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {Readable} = require('node:stream');
const {downloadPublicMedia, isPublicAddress} = require('../lib/public-media');

function transport(responses) {
  const calls = [];
  return {
    calls,
    request(url, options, callback) {
      calls.push({url: String(url), options});
      const req = new EventEmitter();
      req.end = () => {
        const spec = responses.shift();
        const response = Readable.from(spec.chunks || [Buffer.from('voice')]);
        response.statusCode = spec.status || 200;
        response.headers = spec.headers || {'content-type': 'audio/wav'};
        queueMicrotask(() => callback(response));
      };
      return req;
    }
  };
}
const publicLookup = async() => [{address: '8.8.8.8', family: 4}];

test('public CDN downloads pin DNS and carry no credentials', async() => {
  const mock = transport([{}]);
  let lookups = 0;
  const result = await downloadPublicMedia('https://new-cdn.example/voice?signature=secret', {
    request: mock.request,
    lookup: async() => {
      lookups++;
      return publicLookup();
    }
  });
  assert.equal(result.buffer.toString(), 'voice');
  assert.equal(result.mime, 'audio/wav');
  const {options} = mock.calls[0];
  assert.equal(options.agent, false);
  assert.equal(options.headers, undefined);
  options.lookup('new-cdn.example', {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '8.8.8.8');
    assert.equal(family, 4);
  });
  options.lookup('new-cdn.example', {all: true}, (error, addresses) => {
    assert.deepEqual(addresses, [{address: '8.8.8.8', family: 4}]);
  });
  assert.equal(lookups, 1);
});

test('private, reserved, metadata and mapped addresses are denied', async() => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1',
    '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1', '::1',
    'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address);
    await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
      lookup: async() => [{address, family: address.includes(':') ? 6 : 4}],
      request: () => assert.fail('must not connect')
    }), {code: 'QQ_MEDIA_URL_DENIED'});
  }
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    lookup: async() => [...await publicLookup(), {address: '10.0.0.1', family: 4}]
  }), {code: 'QQ_MEDIA_URL_DENIED'});
});

test('redirects validate every destination and never downgrade HTTPS', async() => {
  const mock = transport([{status: 302, headers: {location: 'https://other.example/wav'}}, {}]);
  const names = [];
  await downloadPublicMedia('https://cdn.example/a', {
    request: mock.request,
    lookup: async name => {
      names.push(name);
      return publicLookup();
    }
  });
  assert.deepEqual(names, ['cdn.example', 'other.example']);
  for (const location of ['http://other.example/a', 'https://127.1/a',
    'https://user:pass@other.example/a', 'https://other.example:8443/a']) {
    const blocked = transport([{status: 302, headers: {location}}]);
    await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
      request: blocked.request, lookup: publicLookup
    }), {code: 'QQ_MEDIA_URL_DENIED'});
    assert.equal(blocked.calls.length, 1);
  }
  const privateRedirect = transport([{status: 302, headers: {location: 'https://internal.example/a'}}]);
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    request: privateRedirect.request,
    lookup: async name => name === 'cdn.example' ? publicLookup() : [{address: '10.0.0.1', family: 4}]
  }), {code: 'QQ_MEDIA_URL_DENIED'});
});

test('redirect loops, HTTP failures, and oversized responses stop downloading', async() => {
  const loop = transport(Array.from({length: 4}, () => ({status: 302, headers: {location: '/again'}})));
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    request: loop.request, lookup: publicLookup
  }), {code: 'QQ_DOWNLOAD_FAILED'});
  assert.equal(loop.calls.length, 4);
  for (const spec of [{headers: {'content-length': '9'}}, {chunks: [Buffer.alloc(5), Buffer.alloc(5)]}]) {
    const mock = transport([spec]);
    await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
      request: mock.request, lookup: publicLookup, limit: 8
    }), {code: 'MEDIA_SIZE_INVALID'});
  }
  const mock = transport([{status: 403}]);
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    request: mock.request, lookup: publicLookup
  }), {code: 'QQ_DOWNLOAD_FAILED', httpStatus: 403});
});

test('deadline covers DNS and connection establishment without leaking upstream errors', async() => {
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    lookup: () => new Promise(() => {}), timeout: 10
  }), {code: 'QQ_DOWNLOAD_FAILED'});
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    lookup: publicLookup,
    timeout: 10,
    request() {
      const req = new EventEmitter();
      req.end = () => {};
      return req;
    }
  }), {code: 'QQ_DOWNLOAD_FAILED'});
  await assert.rejects(downloadPublicMedia('https://cdn.example/a?secret=token', {
    lookup: async() => { throw new Error('secret=token'); }
  }), error => error.code === 'QQ_DOWNLOAD_FAILED' && !error.message.includes('token'));
});

test('deadline cancels a stalled response body', async() => {
  let response;
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    lookup: publicLookup,
    timeout: 10,
    request(url, options, callback) {
      const req = new EventEmitter();
      req.end = () => {
        response = new Readable({read() {}});
        response.statusCode = 200;
        response.headers = {};
        queueMicrotask(() => callback(response));
      };
      return req;
    }
  }), {code: 'QQ_DOWNLOAD_FAILED'});
  assert.equal(response.destroyed, true);
});

test('download diagnostics distinguish DNS, TLS, aggregate connection and deadline failures', async() => {
  const {logDetails} = require('../lib/publish-feedback');
  for (const [phase, error] of [
    ['dns', Object.assign(new Error('SECRET URL'), {code: 'ENOTFOUND'})],
    ['connect', Object.assign(new Error('SECRET URL'), {code: 'ERR_TLS_CERT_ALTNAME_INVALID'})],
    ['connect', new AggregateError([
      Object.assign(new Error('SECRET URL'), {code: 'ENETUNREACH'}),
      Object.assign(new Error('SECRET URL'), {code: 'ECONNRESET'})
    ])]
  ]) {
    await assert.rejects(downloadPublicMedia('https://cdn.example/a?token=SECRET', {
      lookup: phase === 'dns' ? async() => { throw error; } : publicLookup,
      request() { throw error; }
    }), failure => {
      const detail = JSON.parse(logDetails(failure, 'download')).causes[0];
      assert.equal(detail.download.phase, phase);
      assert.deepEqual(detail.download.networkCodes, phase === 'dns' ? ['ENOTFOUND'] :
        error instanceof AggregateError ? ['ENETUNREACH', 'ECONNRESET'] : ['ERR_TLS_CERT_ALTNAME_INVALID']);
      assert.ok(!JSON.stringify(failure).includes('SECRET'));
      assert.ok(!logDetails(failure).includes('SECRET'));
      return true;
    });
  }
  await assert.rejects(downloadPublicMedia('https://cdn.example/a', {
    lookup: () => new Promise(() => {}), timeout: 10
  }), error => error.download.phase === 'dns' && error.download.reason === 'deadline');
  const untrusted = Object.assign(new Error(), {
    code: 'QQ_DOWNLOAD_FAILED',
    download: {phase: 'SECRET', reason: 'SECRET', hop: 999, networkCodes: ['SECRET', 'ECONNRESET']}
  });
  assert.deepEqual(JSON.parse(logDetails(untrusted)).causes[0].download, {networkCodes: ['ECONNRESET']});
});
