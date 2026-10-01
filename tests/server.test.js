'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer, findExecutableTwin } = require('../src/server');
const { GameStore, OS_KEY } = require('../src/games');
const { QuestQueue } = require('../src/queue');

// Windows executables carry .exe; the other platforms' do not, and a ".exe" process path is
// refused outright off Windows. Fixtures that mimic Discord's own entries have to follow suit,
// or they describe a path that could never exist on the OS the test is running on.
const exe = (base) => (OS_KEY === 'win32' ? base + '.exe' : base);

async function fixture(t) {
  const store = Object.create(GameStore.prototype);
  store.games = Array.from({ length: 600 }, (_, i) => ({
    id: String(i), name: 'Game ' + i, aliases: [],
    executables: [{ name: 'game-' + i, os: OS_KEY }]
  }));
  const config = { host: '127.0.0.1', presets: [], queue: [], configPath: '/unused/config.json' };
  store.config = config;
  store.custom = [];
  store.detectable = [{
    id: '900', name: 'EA Sports FC 26', aliases: [],
    executables: [{ name: 'ea sports fc 26/' + exe('fc26'), os: OS_KEY }]
  }];
  store.saveCustom = () => {}; // never write a real custom-games.json from a test
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
  return { request, origin, headers, calls, store };
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

test('API: rejects a duration that is not a whole number of minutes within the timer\'s limit', async t => {
  // A duration becomes a setTimeout delay, and that delay lives in a 32-bit signed integer of
  // milliseconds - so 100000 minutes is not a very long session, it is one that ends at once.
  // Refused at the edge with a reason, the same way limit/offset are.
  const f = await fixture(t);
  const post = (url, body) => f.request(url, { method: 'POST', headers: f.headers, body: JSON.stringify(body) });
  // JSON has no Infinity, so the overflow cases travel as strings - "Infinity" and "1e309" are
  // what a client actually sends, and Number() turns both back into a non-safe integer.
  for (const bad of [-1, 1.5, 'abc', 'Infinity', '1e309', 100000, Number.MAX_SAFE_INTEGER]) {
    for (const url of ['/api/start', '/api/queue']) {
      const result = await post(url, { id: '1', durationMinutes: bad });
      assert.equal(result.status, 400, url + ' ' + String(bad));
      assert.match(result.data.reason, /durationMinutes must be a whole number of minutes/);
    }
  }
  assert.equal(f.calls.start, 0); // nothing was launched by a rejected request
  // 0 still means "run until stopped", and a normal duration is passed through untouched
  assert.equal((await post('/api/start', { id: '1', durationMinutes: 0 })).status, 200);
  assert.equal((await post('/api/queue', { id: '1', durationMinutes: 30 })).status, 200);
  assert.equal(f.calls.start, 1);
});

test('API: refuses a listener configuration exposed to the network', () => {
  assert.throws(() => createServer({ config: { host: '0.0.0.0' } }), /host must be/);
});

test('findExecutableTwin: a typed path that is, or lacks the folder of, a Discord path finds it', () => {
  const detectable = [
    { id: '1', name: 'EA Sports FC 26', executables: [{ name: 'ea sports fc 26/fc26.exe', os: 'win32' }] },
    { id: '2', name: 'Other', executables: [{ name: 'other/fc26.exe', os: 'darwin' }] }
  ];
  const typed = (name) => ({ executables: [{ name, os: 'win32' }] });
  assert.equal(findExecutableTwin(detectable, typed('EA SPORTS FC 26/FC26.exe')).id, '1');
  assert.equal(findExecutableTwin(detectable, typed('FC26.exe')).id, '1');
  assert.equal(findExecutableTwin(detectable, typed('Games/EA SPORTS FC 26/fc26.exe')).id, '1');
  assert.equal(findExecutableTwin(detectable, typed('EA SPORTS FC 27/FC27.exe')), null);
  // a folder name that merely ends the same is not the same path
  assert.equal(findExecutableTwin(detectable, typed('xea sports fc 26/fc26.exe')), null);

  // Discord's own entry for the given id wins once it lists an executable for this OS
  const own = (executables) => [{ id: '1531874756096295054', name: 'EA Sports FC 27', executables }];
  const byId = { id: '1531874756096295054', executables: [{ name: 'x/FC27.exe', os: 'win32' }] };
  assert.equal(findExecutableTwin(own([{ name: 'ea sports fc 27/fc27.exe', os: 'win32' }]), byId).id, '1531874756096295054');
  assert.equal(findExecutableTwin(own([]), byId), null);
  assert.equal(findExecutableTwin(own([{ name: 'fc27', os: 'darwin' }]), byId), null);
});

test('API: POST /api/custom adds a game by process path, or points at Discord\'s own entry', async t => {
  const f = await fixture(t);
  const post = (body) => f.request('/api/custom', { method: 'POST', headers: f.headers, body: JSON.stringify(body) });

  const bad = await post({ executable: '..\\x' });
  assert.equal(bad.status, 400);

  // A path Discord already lists points at Discord's own entry instead of adding a duplicate -
  // on every OS, since the twin is matched against the fixture built for the running platform.
  const twin = await post({ executable: 'EA SPORTS FC 26\\' + exe('FC26') });
  assert.equal(twin.data.added, false);
  assert.equal(twin.data.useInstead.id, '900');
  assert.equal(f.store.custom.length, 0);

  const added = await post({ executable: 'EA SPORTS FC 27\\' + exe('FC27') });
  assert.equal(added.status, 200);
  assert.equal(added.data.added, true);
  assert.equal(added.data.game.id, 'custom-ea-sports-fc-27');
  assert.equal(f.store.custom.length, 1);

  const forced = await post({ executable: 'EA SPORTS FC 26\\' + exe('FC26'), force: true });
  assert.equal(forced.data.added, true);
});
