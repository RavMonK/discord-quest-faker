'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/server');
const { GameStore, OS_KEY } = require('../src/games');
const { QuestQueue } = require('../src/queue');

async function fixture(t) {
  const store = Object.create(GameStore.prototype);
  store.games = Array.from({ length: 600 }, (_, i) => ({
    id: String(i), name: 'Game ' + i, aliases: [],
    executables: [{ name: 'game-' + i, os: OS_KEY }]
  }));
  const config = { host: '127.0.0.1', presets: [], queue: [], configPath: '/unused/config.json' };
  store.config = config;
  store.custom = [];
  const calls = { start: 0, stop: 0, save: 0 };
  const spoofer = {
    start() { calls.start++; return { ok: true, sessions: [] }; },
    stopAll() { calls.stop++; return 0; }, list: () => [], onSessionEnd() {}
  };
  const queue = new QuestQueue({ config, store, spoofer, save: () => { calls.save++; return {}; } });
  const { server } = createServer({ config, store, spoofer, queue });
  await new Promise(resolve => server.listen(0, config.host, resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const origin = 'http://127.0.0.1:' + port;
  const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method,
      headers: { ...headers, ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }) } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
  const session = await request('/api/session');
  assert.equal(session.status, 200);
  const headers = { 'X-DQF-Token': session.data.token, 'Content-Type': 'application/json' };
  return { request, origin, headers, calls };
}

test('API: same-origin session permits reads and commands; token stays out of static HTML', async t => {
  const f = await fixture(t);
  const session = await f.request('/api/session', { headers: { Origin: f.origin, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(session.headers['cache-control'], 'no-store');
  assert.match(session.data.token, /^[a-f0-9]{64}$/);
  const html = await f.request('/');
  assert.equal(html.status, 200);
  assert.equal(html.data.includes(session.data.token), false);
  assert.equal(html.headers['x-frame-options'], 'DENY');
  assert.equal((await f.request('/api/state', { headers: f.headers })).status, 200);
  assert.equal((await f.request('/api/start', { method: 'POST', headers: { ...f.headers, Origin: f.origin }, body: '{"id":"1"}' })).status, 200);
  assert.equal((await f.request('/api/stop-all', { method: 'POST', headers: f.headers })).status, 200);
  assert.deepEqual(f.calls, { start: 1, stop: 1, save: 0 });
});

test('API: rejects cross-origin, null-origin, same-site and cross-site requests before effects', async t => {
  const f = await fixture(t);
  for (const extra of [{ Origin: 'https://untrusted.example' }, { Origin: 'null' },
    { Origin: f.origin + '1' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await f.request('/api/session', { headers: extra })).status, 403);
    assert.equal((await f.request('/api/start', { method: 'POST', headers: { ...f.headers, ...extra }, body: '{"id":"1"}' })).status, 403);
  }
  assert.equal(f.calls.start, 0);
});

test('API: all protected methods need a valid token and mutations require JSON content type', async t => {
  const f = await fixture(t);
  for (const token of [undefined, 'wrong', '0'.repeat(64), 'é'.repeat(64)]) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-DQF-Token'] = token;
    for (const [method, url] of [['GET', '/api/state'], ['POST', '/api/stop-all'],
      ['PATCH', '/api/queue'], ['DELETE', '/api/queue']]) {
      const result = await f.request(url, { method, headers, body: '{}' });
      assert.equal(result.status, 403);
      assert.equal(result.data.code, 'invalid_token');
    }
  }
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    assert.equal((await f.request('/api/start', { method: 'POST',
      headers: { ...f.headers, 'Content-Type': contentType }, body: '{"id":"1"}' })).status, 415);
  }
  assert.deepEqual(f.calls, { start: 0, stop: 0, save: 0 });
});

test('API: malformed Host and URL return errors without killing the server', async t => {
  const f = await fixture(t);
  for (const host of ['[', 'untrusted.example', 'localhost@untrusted.example', 'localhost/path', 'localhost:999999']) {
    assert.equal((await f.request('/api/session', { headers: { Host: host } })).status, 400);
    assert.equal((await f.request('/api/session')).status, 200);
  }
  assert.equal((await f.request('/api/session', { headers: { Host: '127.0.0.1:1' } })).status, 403);
  for (const target of ['//untrusted.example/api/session', 'http://untrusted.example/api/session', '/\\untrusted.example/api/session']) {
    assert.equal((await f.request(target)).status, 400);
  }
  assert.equal((await f.request('/api/state', { headers: f.headers })).status, 200);
});

test('API: rejects invalid pagination and serves both boundaries correctly', async t => {
  const f = await fixture(t);
  for (const limit of ['-1', '0', '1.5', '501', 'Infinity', 'NaN', '', '1e309']) {
    assert.equal((await f.request('/api/games?limit=' + limit, { headers: f.headers })).status, 400);
  }
  for (const offset of ['-1', '1.5', 'Infinity', '9007199254740992']) {
    assert.equal((await f.request('/api/games?offset=' + offset, { headers: f.headers })).status, 400);
  }
  for (const limit of [1, 500]) {
    const result = await f.request('/api/games?limit=' + limit, { headers: f.headers });
    assert.equal(result.status, 200);
    assert.equal(result.data.items.length, limit);
  }
  assert.equal((await f.request('/api/games?limit=500&offset=500', { headers: f.headers })).data.items.length, 100);
});

test('API: authenticated queue actions persist only through the injected save', async t => {
  const f = await fixture(t);
  const added = await f.request('/api/queue', { method: 'POST', headers: f.headers, body: '{"id":"1","durationMinutes":1}' });
  assert.equal(added.status, 200);
  assert.equal(added.data.queue.items.length, 1);
  assert.equal(f.calls.save, 1);
  assert.equal((await f.request('/api/queue', { method: 'DELETE', headers: f.headers, body: '{"all":true}' })).status, 200);
  assert.equal(f.calls.save, 2);
});

test('API: refuses a listener configuration exposed to the network', () => {
  assert.throws(() => createServer({ config: { host: '0.0.0.0' } }), /host must be/);
});
