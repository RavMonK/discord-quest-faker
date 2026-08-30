'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Spoofer } = require('../src/spoof');

function tmpSpoofer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-spoof-'));
  return new Spoofer({ runtimePath: dir, maxConcurrent: 12, defaultDurationMinutes: 0 });
}

test('safeName: strips filesystem-unsafe characters from arbitrary ids', () => {
  assert.equal(Spoofer.safeName('steam:3787240'), 'steam_3787240');
  assert.equal(Spoofer.safeName('../../etc'), '.._.._etc');
  assert.equal(Spoofer.safeName('normal_Name-1.2'), 'normal_Name-1.2');
});

test('signalToken: alphanumeric only (waitfor signal names allow nothing else)', () => {
  const token = Spoofer.signalToken('steam:123', 'weird name!@#.exe');
  assert.match(token, /^[0-9a-zA-Z]+$/);
  assert.match(token, /^DQFsteam123/i);
});

test('signalToken: is deterministic and differs for different executables of the same game', () => {
  const a = Spoofer.signalToken('42', 'game.exe');
  const b = Spoofer.signalToken('42', 'launcher.exe');
  assert.equal(Spoofer.signalToken('42', 'game.exe'), a); // deterministic
  assert.notEqual(a, b);
});

test('candidates: filters to the requested OS and dedupes case-insensitively', () => {
  const game = {
    executables: [
      { name: 'Game.exe', os: 'win32', isLauncher: false },
      { name: 'game.exe', os: 'win32', isLauncher: false }, // duplicate, different case
      { name: 'launcher.exe', os: 'win32', isLauncher: true },
      { name: 'Game', os: 'darwin', isLauncher: false }
    ]
  };
  const win32 = Spoofer.candidates(game, 'win32');
  assert.equal(win32.length, 2);
  assert.equal(win32[win32.length - 1].isLauncher, true); // launchers sort last

  const darwin = Spoofer.candidates(game, 'darwin');
  assert.equal(darwin.length, 1);
});

test('select: "all" returns every candidate, a name returns a match, an out-of-range index returns nothing', () => {
  const game = { executables: [
    { name: 'a.exe', os: 'win32', isLauncher: false },
    { name: 'b.exe', os: 'win32', isLauncher: false }
  ] };

  assert.equal(Spoofer.select(game, 'all').length, 2);
  assert.deepEqual(Spoofer.select(game, 'b.exe').map((e) => e.name), ['b.exe']);
  assert.deepEqual(Spoofer.select(game, 1).map((e) => e.name), ['b.exe']);
  assert.deepEqual(Spoofer.select(game, 99), []);
  assert.deepEqual(Spoofer.select(game, undefined).map((e) => e.name), ['a.exe']); // default: first
});

test('materialize: recreates the directory prefix so Discord\'s path-tail match still works', () => {
  const spoofer = tmpSpoofer();
  const target = spoofer.materialize({ id: 'wow' }, { name: '_retail_/wow-64.exe', os: 'win32' });
  assert.equal(path.basename(target), 'wow-64.exe');
  assert.equal(path.basename(path.dirname(target)), '_retail_');
  assert.ok(fs.existsSync(path.dirname(target))); // directory was created
});

test('materialize: builds a minimal macOS bundle so the path ends Foo.app/Contents/MacOS/Foo', () => {
  const spoofer = tmpSpoofer();
  const target = spoofer.materialize({ id: 'mac1' }, { name: 'Foo.app', os: 'darwin' });
  assert.ok(target.replace(/\\/g, '/').endsWith('Foo.app/Contents/MacOS/Foo'));
  assert.ok(fs.existsSync(path.join(path.dirname(path.dirname(target)), 'Info.plist')));
});

test('materialize: rejects a ".." executable name instead of escaping the per-game directory', () => {
  const spoofer = tmpSpoofer();
  assert.throws(
    () => spoofer.materialize({ id: 'evil' }, { name: 'sub/..', os: 'win32' }),
    /unsafe executable name/
  );
});

test('materialize: rejects an executable name that resolves to "."', () => {
  const spoofer = tmpSpoofer();
  assert.throws(
    () => spoofer.materialize({ id: 'evil2' }, { name: 'sub/.', os: 'win32' }),
    /unsafe executable name/
  );
});

test('startOne: refuses a second start of the same game+executable while one is running', () => {
  const spoofer = tmpSpoofer();
  // Fake a running session directly rather than spawning a real placeholder process.
  const key = Spoofer.sessionKey('99', 'game.exe');
  spoofer.running.set(key, { key, gameId: '99', name: 'Fake', executable: 'game.exe', pid: 1234, startedAt: Date.now(), durationMinutes: 0, restarts: 0 });

  const result = spoofer.startOne({ id: '99', name: 'Fake' }, { name: 'game.exe', os: 'win32' }, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /already running/);
});

test('startOne: refuses to exceed maxConcurrent', () => {
  const spoofer = tmpSpoofer();
  spoofer.config.maxConcurrent = 1;
  spoofer.running.set('existing::x.exe', { key: 'existing::x.exe' });

  const result = spoofer.startOne({ id: 'new', name: 'New' }, { name: 'y.exe', os: 'win32' }, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /limit reached/);
});
