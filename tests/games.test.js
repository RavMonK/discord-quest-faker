'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GameStore, normalize, fold } = require('../src/games');

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-games-'));
  return {
    gamesPath: path.join(dir, 'games.json'),
    customPath: path.join(dir, 'custom-games.json'),
    apiUrl: 'https://discord.com/api/v10/applications/detectable'
  };
}

test('normalize: drops apps with no executables', () => {
  const games = normalize([{ id: '1', name: 'No Exes', executables: [] }]);
  assert.equal(games.length, 0);
});

test('normalize: drops executables with a ".." path segment (traversal guard)', () => {
  const games = normalize([{
    id: '2',
    name: 'Sneaky',
    executables: [
      { name: '../../escape.exe' },
      { name: 'sub/../up.exe' },
      { name: 'safe/game.exe' }
    ]
  }]);
  assert.equal(games.length, 1);
  assert.deepEqual(games[0].executables.map((e) => e.name), ['safe/game.exe']);
});

test('normalize: a game left with zero executables after filtering is dropped entirely', () => {
  const games = normalize([{ id: '3', name: 'All Bad', executables: [{ name: '../bad.exe' }] }]);
  assert.equal(games.length, 0);
});

test('normalize: defaults os to win32 and coerces is_launcher to boolean', () => {
  const games = normalize([{
    id: '4',
    name: 'Defaults',
    executables: [{ name: 'game.exe' }, { name: 'launcher.exe', os: 'darwin', is_launcher: 1 }]
  }]);
  assert.equal(games[0].executables[0].os, 'win32');
  assert.equal(games[0].executables[0].isLauncher, false);
  assert.equal(games[0].executables[1].os, 'darwin');
  assert.equal(games[0].executables[1].isLauncher, true);
});

test('normalize: sorts games alphabetically by name', () => {
  const games = normalize([
    { id: '1', name: 'Zelda-like', executables: [{ name: 'a.exe' }] },
    { id: '2', name: 'Alpha Quest', executables: [{ name: 'b.exe' }] }
  ]);
  assert.deepEqual(games.map((g) => g.name), ['Alpha Quest', 'Zelda-like']);
});

test('fold: strips accents and lowercases, so search matches diacritics', () => {
  assert.equal(fold('MARVEL Tōkon'), 'marvel tokon');
  assert.equal(fold('Pokémon'), 'pokemon');
  assert.equal(fold(null), '');
});

test('GameStore: merge lets a custom entry override a detectable one with the same id', () => {
  const store = new GameStore(tmpConfig());
  store.detectable = [{ id: '42', name: 'Discord Version', aliases: [], icon: null, executables: [{ name: 'a.exe', os: 'win32', isLauncher: false }] }];
  store.addCustom({ id: '42', name: 'Steam Version', aliases: [], icon: null, custom: true, executables: [{ name: 'b.exe', os: 'win32', isLauncher: false }] });
  store.merge();
  assert.equal(store.byId('42').name, 'Steam Version');
  assert.equal(store.games.length, 1);
});

test('GameStore: resolve() finds a game by id, exact name, alias, or executable name', () => {
  const store = new GameStore(tmpConfig());
  store.detectable = [{
    id: '7', name: 'Example Game', aliases: ['exg'], icon: null,
    executables: [{ name: 'example.exe', os: 'win32', isLauncher: false }]
  }];
  store.merge();

  assert.equal(store.resolve('7').name, 'Example Game');
  assert.equal(store.resolve('Example Game').id, '7');
  assert.equal(store.resolve('exg').id, '7');
  assert.equal(store.resolve('example.exe').id, '7');
  assert.equal(store.resolve('nonexistent'), null);
});

test('GameStore: addCustom persists to disk and removeCustom removes it', () => {
  const config = tmpConfig();
  const store = new GameStore(config);
  store.addCustom({ id: 'steam:1', name: 'Custom Game', aliases: [], icon: null, custom: true, executables: [{ name: 'c.exe', os: 'win32', isLauncher: false }] });

  assert.ok(fs.existsSync(config.customPath));
  const onDisk = JSON.parse(fs.readFileSync(config.customPath, 'utf8'));
  assert.equal(onDisk.games.length, 1);

  const removed = store.removeCustom('steam:1');
  assert.equal(removed, true);
  assert.equal(store.byId('steam:1'), null);
  assert.equal(store.removeCustom('steam:1'), false); // already gone
});

test('GameStore: search filters by current OS and ranks exact matches first', () => {
  const store = new GameStore(tmpConfig());
  store.detectable = [
    { id: '1', name: 'Alpha', aliases: [], icon: null, executables: [{ name: 'alpha.exe', os: 'win32', isLauncher: false }] },
    { id: '2', name: 'Alphabet', aliases: [], icon: null, executables: [{ name: 'ab.exe', os: 'win32', isLauncher: false }] },
    { id: '3', name: 'Mac Only', aliases: [], icon: null, executables: [{ name: 'mac.app', os: 'darwin', isLauncher: false }] }
  ];
  store.merge();

  const result = store.search('alpha', { osKey: 'win32' });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'Alpha'); // exact match ranked before "Alphabet"

  const macResult = store.search('', { osKey: 'win32' });
  assert.ok(!macResult.items.some((g) => g.id === '3')); // darwin-only game hidden on win32
});
