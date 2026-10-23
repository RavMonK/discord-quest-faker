'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { GameStore, normalize, fold, parseProcessPath, customGame, withDiscordDetails, fetchJson } = require('../src/games');
const { Spoofer } = require('../src/spoof');

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

test('normalize: tags a source when asked and drops executables that need a command line', () => {
  // Opera GX's real non-games entry: Discord matches "opera.exe" only together with that
  // argument, which a placeholder started by name alone never carries.
  const games = normalize([{
    id: '1461077510887309650',
    name: 'Opera GX',
    executables: [
      { name: 'operagx/opera.exe', os: 'win32' },
      { name: 'opera.exe', os: 'win32', arguments: '--with-feature:gx-post-mortem=on' },
      { name: 'opera.exe', os: 'win32', arguments: '   ' }
    ]
  }], { source: 'non-game' });
  assert.equal(games[0].source, 'non-game');
  assert.deepEqual(games[0].executables.map((e) => e.name), ['operagx/opera.exe', 'opera.exe']);
  assert.equal('source' in normalize([{ id: '1', name: 'Plain', executables: [{ name: 'a.exe' }] }])[0], false);
});

test('GameStore: refresh merges the non-games list and survives it failing', async (t) => {
  const games = JSON.stringify([
    { id: '1442729602559643668', name: 'Firefox', executables: [] },
    { id: '1', name: 'Real Game', executables: [{ name: 'game.exe' }] }
  ]);
  const nonGames = JSON.stringify([
    { id: '1491208267928703226', name: 'Firefox', executables: [{ name: 'firefox.exe', os: 'win32' }, { name: 'firefox.app', os: 'darwin' }] },
    // an id the games list already owns must not be duplicated
    { id: '1', name: 'Real Game again', executables: [{ name: 'game.exe', os: 'win32' }] }
  ]);
  let nonGamesBroken = false;
  const api = http.createServer((req, res) => {
    if (req.url === '/non-games' && nonGamesBroken) {
      res.writeHead(500);
      res.end('nope');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(req.url === '/non-games' ? nonGames : games);
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));

  const config = tmpConfig();
  config.apiUrl = 'http://127.0.0.1:' + api.address().port + '/detectable';
  config.nonGamesUrl = 'http://127.0.0.1:' + api.address().port + '/non-games';
  // the icon lookup goes to Discord's public /rpc; answer it here so the test stays offline,
  // with a hash for Firefox and nothing for the other id (its icon is null on Discord too)
  const rpcHits = [];
  const fetcher = (url) => {
    const m = /\/applications\/(\d+)\/rpc$/.exec(url);
    if (!m) return fetchJson(url);
    rpcHits.push(m[1]);
    return Promise.resolve({ id: m[1], name: 'Firefox Browser', icon: m[1].startsWith('149') ? 'ab'.repeat(16) : null });
  };
  const store = new GameStore(config, { fetcher });

  const result = await store.refresh();
  assert.equal(result.ok, true);
  assert.equal(result.nonGames, 2);
  assert.deepEqual(store.games.map((g) => g.id), ['1491208267928703226', '1']);
  const firefox = store.byId('1491208267928703226');
  assert.equal(firefox.source, 'non-game');
  assert.equal(firefox.name, 'Firefox', 'the list name wins over the application name');
  assert.equal(firefox.icon, 'ab'.repeat(16));
  assert.equal('namedByUser' in firefox, false);
  assert.deepEqual(rpcHits, ['1491208267928703226'], 'only Discord-shaped ids are looked up');
  assert.equal(store.byId('1').source, undefined);
  assert.equal(store.search('firefox', { osKey: 'win32' }).items[0].source, 'non-game');
  assert.equal(store.meta().nonGames, 1);

  // the cache round-trips the tag, so a restart offline still shows the entry as a non-game
  const reloaded = new GameStore(config, { fetcher });
  assert.equal(reloaded.byId('1491208267928703226').source, 'non-game');

  // the side list failing is not a failed refresh, and the last good non-games are kept
  nonGamesBroken = true;
  const again = await store.refresh();
  assert.equal(again.ok, true);
  assert.equal(store.byId('1491208267928703226').source, 'non-game');

  // no url configured means no non-games at all
  config.nonGamesUrl = '';
  const bare = new GameStore(config, { fetcher });
  bare.detectable = [];
  await bare.refresh();
  assert.equal(bare.byId('1491208267928703226'), null);
});

test('fold: strips accents and lowercases, so search matches diacritics', () => {
  assert.equal(fold('MARVEL Tōkon'), 'marvel tokon');
  assert.equal(fold('Pokémon'), 'pokemon');
  assert.equal(fold(null), '');
});

test('GameStore: a custom entry on a detectable id adds its executables instead of hiding Discord\'s', () => {
  const store = new GameStore(tmpConfig());
  store.detectable = [{ id: '42', name: 'Discord Version', aliases: [], icon: null, executables: [{ name: 'a.exe', os: 'win32', isLauncher: false }] }];
  store.addCustom({ id: '42', name: 'Custom Version', aliases: [], icon: null, custom: true, source: 'custom', executables: [
    { name: 'b.exe', os: 'win32', isLauncher: false },
    { name: 'A.EXE', os: 'win32', isLauncher: false } // already Discord's, any case
  ] });
  store.merge();
  const game = store.byId('42');
  assert.equal(game.name, 'Discord Version');
  assert.deepEqual(game.executables.map((e) => e.name), ['a.exe', 'b.exe']);
  assert.equal(game.custom, true); // still removable with the panel's ✕
  assert.equal(store.games.length, 1);
  assert.equal(store.detectable[0].executables.length, 1); // Discord's list itself is untouched

  store.removeCustom('42');
  assert.deepEqual(store.byId('42').executables.map((e) => e.name), ['a.exe']);
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

test('GameStore: two refreshes at once resolve to one fetch and one refusal', async (t) => {
  // A stand-in for the Discord API that answers slowly on purpose, so the second refresh
  // call is guaranteed to land while the first one is still waiting for its response.
  const payload = JSON.stringify([{ id: '9', name: 'Slow Game', executables: [{ name: 'slow.exe' }] }]);
  let requests = 0;
  const api = http.createServer((req, res) => {
    requests += 1;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
    }, 100);
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));

  const config = tmpConfig();
  config.apiUrl = 'http://127.0.0.1:' + api.address().port + '/detectable';
  const store = new GameStore(config);

  // refresh() sets `refreshing` synchronously before its first await, so the overlapping
  // second call takes the refusal branch deterministically - no race in the assertion.
  const results = await Promise.all([store.refresh(), store.refresh()]);

  const wins = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);
  assert.equal(wins.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, 'already refreshing');
  assert.equal(requests, 1, 'the refused call must not fire a second request');
  assert.equal(store.refreshing, false);
  assert.equal(store.games.length, 1);
  assert.equal(store.games[0].name, 'Slow Game');
  assert.equal(store.source, 'api');
});

test('parseProcessPath: turns a typed Windows path into the detectable-list form', () => {
  assert.equal(parseProcessPath('EA SPORTS FC 27\\FC27.exe', 'win32'), 'EA SPORTS FC 27/FC27.exe');
  assert.equal(parseProcessPath('  "FC27.exe" ', 'win32'), 'FC27.exe');
  // a full path out of Task Manager loses its drive and leading separators, keeps the rest
  assert.equal(parseProcessPath('C:\\Games\\EA SPORTS FC 27\\FC27.exe', 'win32'), 'Games/EA SPORTS FC 27/FC27.exe');
  assert.equal(parseProcessPath('./a//b/./c.exe', 'win32'), 'a/b/c.exe');
});

test('parseProcessPath: refuses paths that would escape or never run', () => {
  assert.throws(() => parseProcessPath('', 'win32'), /process path/);
  assert.throws(() => parseProcessPath('..\\up.exe', 'win32'), /"\.\."/);
  assert.throws(() => parseProcessPath('a/b?.exe', 'win32'), /cannot contain/);
  assert.throws(() => parseProcessPath('folder. /x.exe', 'win32'), /dot or a space/);
  assert.throws(() => parseProcessPath('FC27', 'win32'), /ends in \.exe/);
  // a foo.exe process is impossible for a real game on macOS/Linux
  assert.throws(() => parseProcessPath('FC27.exe', 'darwin'), /Windows/);
  assert.equal(parseProcessPath('Game.app', 'darwin'), 'Game.app');
  assert.throws(() => parseProcessPath('a/'.repeat(100) + 'x.exe', 'win32'), /too long/);
});

test('customGame: names the game after its folder and gives it a path-safe id', () => {
  const game = customGame('EA SPORTS FC 27\\FC27.exe', '', 'win32');
  assert.equal(game.name, 'EA SPORTS FC 27');
  assert.equal(game.id, 'custom-ea-sports-fc-27');
  assert.equal(game.source, 'custom');
  assert.equal(game.custom, true);
  assert.deepEqual(game.executables, [{ name: 'EA SPORTS FC 27/FC27.exe', os: 'win32', isLauncher: false }]);

  assert.equal(customGame('FC27.exe', '', 'win32').name, 'FC27');
  assert.equal(customGame('x/FC27.exe', 'My Game', 'win32').name, 'My Game');
  // a name with nothing Latin in it still yields an id Spoofer accepts as a directory
  const thai = customGame('x/game.exe', 'เกม', 'win32');
  assert.match(thai.id, /^custom-[0-9a-f]{12}$/);
  assert.equal(Spoofer.gameDirectory(thai.id), thai.id);
  assert.equal(Spoofer.gameDirectory(game.id), game.id);
});

test('GameStore: addCustom with merge adds a second executable to the same custom game', () => {
  const store = new GameStore(tmpConfig());
  store.addCustom(customGame('EA SPORTS FC 27\\FC27.exe', '', 'win32'), { merge: true });
  store.addCustom(customGame('EA SPORTS FC 27\\FC27_Trial.exe', '', 'win32'), { merge: true });
  store.addCustom(customGame('EA SPORTS FC 27\\fc27.EXE', '', 'win32'), { merge: true }); // duplicate, any case
  const game = store.byId('custom-ea-sports-fc-27');
  assert.deepEqual(game.executables.map((e) => e.name), ['EA SPORTS FC 27/FC27.exe', 'EA SPORTS FC 27/FC27_Trial.exe']);
  assert.equal(store.custom.length, 1);
});

test('customGame: a Discord game id leading the path, in the name field, or passed on its own becomes the id', () => {
  const led = customGame('1531874756096295054\\EA SPORTS FC 27\\FC27.exe', '', 'win32');
  assert.equal(led.id, '1531874756096295054');
  assert.equal(led.name, 'EA SPORTS FC 27');
  assert.deepEqual(led.executables.map((e) => e.name), ['EA SPORTS FC 27/FC27.exe']); // the id is not a folder

  const named = customGame('EA SPORTS FC 27\\FC27.exe', '1531874756096295054', 'win32');
  assert.equal(named.id, '1531874756096295054');
  assert.equal(named.name, 'EA SPORTS FC 27');
  assert.equal(named.namedByUser, false);

  const passed = customGame('FC27.exe', 'My FC', 'win32', '1531874756096295054');
  assert.equal(passed.id, '1531874756096295054');
  assert.equal(passed.name, 'My FC');
  assert.equal(passed.namedByUser, true);

  // a short number is a folder name, not an id
  assert.equal(customGame('2024\\game.exe', '', 'win32').id, 'custom-2024');
  assert.throws(() => customGame('1531874756096295054\\FC27.exe', '', 'win32', '1421154726023532544'), /two different/);
  assert.throws(() => customGame('FC27.exe', '', 'win32', 'abc'), /not a Discord game id/);
});

test('withDiscordDetails: takes the name and icon from Discord, keeps a typed name, never breaks on failure', async () => {
  const app = { id: '1531874756096295054', name: 'EA Sports FC 27', icon: 'eddb3390e22763c8c7449ea393ca665d' };
  const urls = [];
  const fetcher = async (url) => { urls.push(url); return app; };

  const looked = await withDiscordDetails(customGame('1531874756096295054\\FC27.exe', '', 'win32'), fetcher);
  assert.equal(looked.looked, true);
  assert.equal(looked.game.name, 'EA Sports FC 27');
  assert.equal(looked.game.icon, app.icon);
  assert.equal('namedByUser' in looked.game, false); // never written to custom-games.json
  assert.deepEqual(urls, ['https://discord.com/api/v10/applications/1531874756096295054/rpc']);

  const kept = await withDiscordDetails(customGame('FC27.exe', 'Mine', 'win32', app.id), fetcher);
  assert.equal(kept.game.name, 'Mine');

  const odd = await withDiscordDetails(customGame('FC27.exe', '', 'win32', app.id),
    async () => ({ ...app, icon: '../../x' }));
  assert.equal(odd.game.icon, null); // only a hash may go into the CDN URL

  const failed = await withDiscordDetails(customGame('FC27.exe', '', 'win32', app.id),
    async () => { throw new Error('HTTP 404'); });
  assert.equal(failed.looked, false);
  assert.equal(failed.error, 'HTTP 404');
  assert.equal(failed.game.name, 'FC27');

  // no Discord id, no request
  const plain = await withDiscordDetails(customGame('x\\FC27.exe', '', 'win32'), fetcher);
  assert.equal(plain.looked, false);
  assert.equal(urls.length, 2);
});

test('customGame: names that differ only by punctuation do not share an id', () => {
  const a = customGame('x/Foo.exe', 'Foo: Bar', 'win32');
  const b = customGame('x/Foo.exe', 'Foo Bar', 'win32');
  const c = customGame('x/Foo.exe', 'Foo Bar!', 'win32');
  assert.notEqual(a.id, b.id);
  assert.notEqual(b.id, c.id);
  assert.equal(b.id, 'custom-foo-bar'); // a plain name keeps the id it always had
  assert.match(a.id, /^custom-[a-z0-9-]+$/); // still a safe directory name
  assert.equal(customGame('x/Foo.exe', 'Foo: Bar', 'win32').id, a.id); // and it is stable
});

test('GameStore: reads both game files with a UTF-8 BOM, and gives every entry aliases', () => {
  const config = tmpConfig();
  const bom = '\uFEFF';
  const exe = [{ name: 'a/a.exe', os: 'win32', isLauncher: false }];
  // no `aliases` on either entry: an older cache or a hand edit looks like this
  fs.writeFileSync(config.gamesPath, bom + JSON.stringify({ games: [{ id: '1', name: 'Alpha', executables: exe }] }));
  fs.writeFileSync(config.customPath, bom + JSON.stringify({ games: [{ id: 'custom-b', name: 'Beta', executables: exe }] }));

  const store = new GameStore(config);
  assert.deepEqual(store.detectable.map((g) => g.id), ['1']);
  assert.deepEqual(store.custom.map((g) => g.id), ['custom-b']);
  // these used to throw "Cannot read properties of undefined (reading 'some')"
  assert.equal(store.resolve('Alpha').id, '1');
  assert.equal(store.resolve('nothing-like-this'), null);
  assert.equal(store.search('beta', { onlyThisOs: false }).total, 1);
});

test('GameStore: an entry with no executables list is skipped instead of breaking the load', () => {
  const config = tmpConfig();
  fs.writeFileSync(config.gamesPath, JSON.stringify({ games: [{ id: '1', name: 'Broken' }, null] }));
  const store = new GameStore(config);
  assert.equal(store.detectable.length, 0);
});

test('customGame: a macOS bundle path is named after the .app, not the MacOS folder', () => {
  const game = customGame('Games/Bar Game.app/Contents/MacOS/BarGame', '', 'darwin');
  assert.equal(game.name, 'Bar Game');
  assert.equal(game.id, 'custom-bar-game');
  assert.equal(customGame('Foo.app/Contents/MacOS/Foo', '', 'darwin').name, 'Foo');
  assert.equal(customGame('Dir/thing', '', 'darwin').name, 'Dir'); // no .app: unchanged
});
