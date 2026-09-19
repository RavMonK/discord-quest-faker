'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('../src/server');
const { GameStore, OS_KEY } = require('../src/games');
const { Spoofer } = require('../src/spoof');
const { QuestQueue } = require('../src/queue');

/**
 * The real wiring, end to end: GameStore + Spoofer + QuestQueue + createServer, listening on
 * an OS-assigned loopback port. Everything lives in a temp dir and the queue's save is a stub,
 * so no real config.json, game list or runtime directory is touched.
 */
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-smoke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A cached list on disk, so the store starts from it and nothing ever reaches the network.
  // The apiUrl points at a dead port on purpose: if a test ever triggers a refresh the failure
  // is instant and loud instead of a slow outbound call.
  const gamesPath = path.join(dir, 'games.json');
  fs.writeFileSync(gamesPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    source: 'fixture',
    count: 1,
    games: [{
      id: '1',
      name: 'Fixture Game',
      aliases: [],
      icon: null,
      executables: [{ name: 'fixture.exe', os: OS_KEY, isLauncher: false }]
    }]
  }) + '\n', 'utf8');

  const config = {
    host: '127.0.0.1',
    gamesFile: 'games.json',
    gamesPath,
    customPath: path.join(dir, 'custom-games.json'),
    apiUrl: 'http://127.0.0.1:1/detectable',
    runtimePath: path.join(dir, 'runtime'),
    presets: [],
    queue: [],
    queueDelayMinSeconds: 0,
    queueDelayMaxSeconds: 0,
    defaultDurationMinutes: 0,
    maxConcurrent: 2,
    refreshIntervalMinutes: 0,
    configPath: path.join(dir, 'config.json') // never written: the queue's save is stubbed
  };

  const store = new GameStore(config);
  assert.equal(store.games.length, 1); // from the fixture file, not the network
  assert.equal(store.source, 'cache');

  const spoofer = new Spoofer(config);
  t.after(() => spoofer.stopAll(true));

  const queue = new QuestQueue({ config, store, spoofer, save: () => ({}) });
  const { server } = createServer({ config, store, spoofer, queue });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const port = server.address().port;
  const origin = 'http://127.0.0.1:' + port;

  const session = await fetch(origin + '/api/session');
  assert.equal(session.status, 200);
  const { token } = await session.json();
  assert.match(token, /^[a-f0-9]{64}$/);

  return { origin, port, token, auth: { 'X-DQF-Token': token } };
}

test('smoke: the static UI is served with its real content types', async (t) => {
  const f = await fixture(t);

  const index = await fetch(f.origin + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);

  const css = await fetch(f.origin + '/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const js = await fetch(f.origin + '/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /text\/javascript/);
});

test('smoke: /api/session hands out a per-process token and /api/state requires it', async (t) => {
  const f = await fixture(t);

  const anonymous = await fetch(f.origin + '/api/state');
  assert.equal(anonymous.status, 403);

  const state = await fetch(f.origin + '/api/state', { headers: f.auth });
  assert.equal(state.status, 200);
  const body = await state.json();
  assert.equal(body.os, OS_KEY);
  assert.ok(body.games && typeof body.games.count === 'number');
  assert.ok(Array.isArray(body.running));
  assert.ok(Array.isArray(body.presets));
});

test('smoke: a mutation with a non-JSON content type is rejected with 415', async (t) => {
  const f = await fixture(t);
  const res = await fetch(f.origin + '/api/start', {
    method: 'POST',
    headers: { ...f.auth, 'Content-Type': 'text/plain' },
    body: '{"id":"1"}'
  });
  assert.equal(res.status, 415);
  // refused before effects: nothing was started, no placeholder process exists
  const state = await (await fetch(f.origin + '/api/state', { headers: f.auth })).json();
  assert.equal(state.running.length, 0);
});

test('smoke: a cross-origin request is refused before the token is even checked', async (t) => {
  const f = await fixture(t);
  const res = await fetch(f.origin + '/api/session', {
    headers: { Origin: 'https://untrusted.example' }
  });
  assert.equal(res.status, 403);
});

test('smoke: a foreign Host header gets a 400 and the server survives', async (t) => {
  const f = await fixture(t);
  // fetch will not let a caller forge Host, so this one goes through a raw request
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: f.port,
      path: '/api/session',
      headers: { Host: 'untrusted.example' }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 400);

  const after = await fetch(f.origin + '/api/state', { headers: f.auth });
  assert.equal(after.status, 200); // still alive and answering
});

test('smoke: /api/games rejects a non-numeric limit', async (t) => {
  const f = await fixture(t);
  const bad = await fetch(f.origin + '/api/games?limit=abc', { headers: f.auth });
  assert.equal(bad.status, 400);

  const good = await fetch(f.origin + '/api/games?limit=10', { headers: f.auth });
  assert.equal(good.status, 200);
  const body = await good.json();
  assert.equal(body.total, 1);
  assert.equal(body.items[0].name, 'Fixture Game');
});
