'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QuestQueue, randomBetween, clampSeconds } = require('../src/queue');
const { OS_KEY } = require('../src/games');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function game(id, name) {
  return {
    id,
    name,
    icon: null,
    executables: [{ name: name.toLowerCase() + '.exe', os: OS_KEY, isLauncher: false }]
  };
}

/**
 * Enough of a Spoofer for the queue: it records what it was asked to start and hands back the
 * session-end callback so a test can end a session the way the real one does.
 */
function fakeSpoofer() {
  const spoofer = {
    started: [],
    stopped: [],
    listeners: [],
    onSessionEnd(fn) { spoofer.listeners.push(fn); },
    start(g, opts) {
      const key = g.id + '::' + (opts.executable || 'default');
      spoofer.started.push({ id: g.id, executable: opts.executable, durationMinutes: opts.durationMinutes });
      return { ok: true, sessions: [{ key, executable: opts.executable }], results: [] };
    },
    stop(key) {
      spoofer.stopped.push(key);
      return { ok: true };
    },
    /** what the real Spoofer does when a session leaves `running` */
    end(key, name, reason) {
      spoofer.listeners.forEach((fn) => fn({ key, name, reason: reason || 'duration' }));
    }
  };
  return spoofer;
}

function build(games, overrides) {
  const list = games.map((g, i) => game(String(100 + i), g));
  const config = Object.assign({
    queue: [],
    queueDelayMinSeconds: 0,
    queueDelayMaxSeconds: 0,
    defaultDurationMinutes: 0
  }, overrides);
  const store = { resolve: (idOrName) => list.find((g) => g.id === String(idOrName) || g.name === idOrName) || null };
  const spoofer = fakeSpoofer();
  // never configModule.save: that writes the user's real config.json
  const queue = new QuestQueue({ config, store, spoofer, save: () => ({}) });
  return { queue, spoofer, config, list };
}

test('randomBetween: stays inside the range and is not a constant', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    const value = randomBetween(30, 70);
    assert.ok(value >= 30 && value <= 70, 'out of range: ' + value);
    assert.equal(value, Math.round(value));
    seen.add(value);
  }
  // the whole point of the gap is that it has no pattern - a single repeated value would be one
  assert.ok(seen.size > 10, 'only ' + seen.size + ' distinct delays in 400 draws');
  assert.equal(randomBetween(45, 45), 45); // a zero-width range still works
});

test('clampSeconds: holds the bounds and falls back on nonsense', () => {
  assert.equal(clampSeconds(45, 30), 45);
  assert.equal(clampSeconds(-10, 30), 0);
  assert.equal(clampSeconds(99999, 30), 3600);
  assert.equal(clampSeconds('abc', 30), 30);
  assert.equal(clampSeconds(41.6, 30), 42);
});

test('delay: a reversed min/max is read the right way round', () => {
  const { queue } = build(['A'], { queueDelayMinSeconds: 70, queueDelayMaxSeconds: 30 });
  assert.deepEqual(queue.delay(), { min: 30, max: 70 });
  assert.deepEqual(queue.setDelay(90, 40), { min: 40, max: 90 });
});

test('add: resolves the game and stores one executable', () => {
  const { queue, list } = build(['Alpha', 'Beta']);
  assert.equal(queue.add({ id: list[0].id, durationMinutes: 15 }).ok, true);
  assert.equal(queue.add({ id: 'nope' }).ok, false);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].executable, 'alpha.exe');
  assert.equal(queue.items[0].durationMinutes, 15);
  assert.equal(queue.items[0].status, 'pending');
});

test('move / remove: keep the order the user set', () => {
  const { queue, list } = build(['Alpha', 'Beta', 'Gamma']);
  list.forEach((g) => queue.add({ id: g.id, durationMinutes: 5 }));
  const [a, b, c] = queue.items.map((i) => i.uid);

  queue.move(c, 'up');
  assert.deepEqual(queue.items.map((i) => i.uid), [a, c, b]);
  queue.move(a, 'up'); // already first - no change, and no error
  assert.deepEqual(queue.items.map((i) => i.uid), [a, c, b]);
  queue.remove(c);
  assert.deepEqual(queue.items.map((i) => i.uid), [a, b]);
  assert.equal(queue.remove('nothing').ok, false);
});

test('the queue plays one game at a time and starts the next when a session ends', async () => {
  const { queue, spoofer, list } = build(['Alpha', 'Beta']);
  list.forEach((g) => queue.add({ id: g.id, durationMinutes: 12 }));

  queue.start();
  assert.equal(queue.running, true);
  assert.equal(spoofer.started.length, 1); // never two games at once
  assert.deepEqual(spoofer.started[0], { id: '100', executable: 'alpha.exe', durationMinutes: 12 });
  assert.equal(queue.items[0].status, 'running');

  spoofer.end('100::alpha.exe', 'Alpha', 'duration');
  assert.equal(queue.items[0].status, 'done');
  assert.equal(spoofer.started.length, 1); // still waiting out the gap

  await sleep(30); // the gap is 0s in this fixture
  assert.equal(spoofer.started.length, 2);
  assert.equal(spoofer.started[1].id, '101');

  spoofer.end('101::beta.exe', 'Beta', 'duration');
  await sleep(30);
  assert.equal(queue.running, false); // nothing left to play
  assert.equal(spoofer.started.length, 2);
});

test('a session that is not the queue\'s own does not move it along', async () => {
  const { queue, spoofer, list } = build(['Alpha', 'Beta']);
  list.forEach((g) => queue.add({ id: g.id, durationMinutes: 12 }));
  queue.start();

  spoofer.end('999::something-else.exe', 'Something Else', 'stopped');
  await sleep(30);
  assert.equal(spoofer.started.length, 1);
  assert.equal(queue.items[0].status, 'running');
});

test('stop: the current game is stopped and the queue does not advance', async () => {
  const { queue, spoofer, list } = build(['Alpha', 'Beta']);
  list.forEach((g) => queue.add({ id: g.id, durationMinutes: 12 }));
  queue.start();

  queue.stop();
  assert.deepEqual(spoofer.stopped, ['100::alpha.exe']);
  // the real spoofer fires the listener from inside stop() - it must not restart the queue
  spoofer.end('100::alpha.exe', 'Alpha', 'stopped');
  await sleep(30);
  assert.equal(queue.running, false);
  assert.equal(spoofer.started.length, 1);
});

test('start: a finished queue replays from the top rather than doing nothing', async () => {
  const { queue, spoofer, list } = build(['Alpha']);
  list.forEach((g) => queue.add({ id: g.id, durationMinutes: 12 }));

  queue.start();
  spoofer.end('100::alpha.exe', 'Alpha', 'duration');
  await sleep(30);
  assert.equal(queue.running, false);
  assert.equal(queue.items[0].status, 'done');

  assert.equal(queue.start().ok, true);
  assert.equal(queue.items[0].status, 'running');
  assert.equal(spoofer.started.length, 2);
});

test('an entry whose game is gone is skipped, not left blocking the queue', async () => {
  const { queue, spoofer, list } = build(['Alpha']);
  queue.items.push(queue.normalize({ id: 'ghost', name: 'Ghost', durationMinutes: 5 }));
  queue.add({ id: list[0].id, durationMinutes: 5 });
  // the ghost is first in the list
  assert.equal(queue.items[0].name, 'Ghost');

  queue.start();
  assert.equal(queue.items[0].status, 'failed');
  await sleep(30);
  assert.equal(spoofer.started.length, 1);
  assert.equal(spoofer.started[0].id, '100');
});

test('skip: stops what is playing and moves to the next entry', async () => {
  const { queue, spoofer, list } = build(['Alpha', 'Beta']);
  list.forEach((g) => queue.add({ id: g.id, durationMinutes: 12 }));
  queue.start();

  queue.skip();
  assert.deepEqual(spoofer.stopped, ['100::alpha.exe']);
  assert.equal(queue.items[0].status, 'skipped');
  spoofer.end('100::alpha.exe', 'Alpha', 'stopped'); // arrives from the stop above
  await sleep(30);
  assert.equal(spoofer.started.length, 2);
  assert.equal(queue.items[1].status, 'running');
});

test('durationOf: an entry with no time of its own falls back to the global setting', () => {
  const { queue, list } = build(['Alpha'], { defaultDurationMinutes: 20 });
  queue.add({ id: list[0].id });
  assert.equal(queue.items[0].durationMinutes, 0);
  assert.equal(queue.durationOf(queue.items[0]), 20);
  queue.update(queue.items[0].uid, { durationMinutes: 7 });
  assert.equal(queue.durationOf(queue.items[0]), 7);
});
