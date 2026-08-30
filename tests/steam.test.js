'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAppId, normalizeExecutable, executablesInArguments, osKeysFor } = require('../src/steam');

test('parseAppId: bare digits pass through', () => {
  assert.equal(parseAppId('3787240'), '3787240');
});

test('parseAppId: steamdb.info URL', () => {
  assert.equal(parseAppId('https://steamdb.info/app/3787240/config/'), '3787240');
});

test('parseAppId: store.steampowered.com URL', () => {
  assert.equal(parseAppId('https://store.steampowered.com/app/730/CounterStrike_2/'), '730');
});

test('parseAppId: steamcommunity.com URL', () => {
  assert.equal(parseAppId('https://steamcommunity.com/app/440'), '440');
});

test('parseAppId: steam:// protocol link', () => {
  assert.equal(parseAppId('steam://run/570'), '570');
});

test('parseAppId: appid query parameter', () => {
  assert.equal(parseAppId('https://example.com/redirect?appid=12345'), '12345');
});

test('parseAppId: garbage input returns null', () => {
  assert.equal(parseAppId('not a steam link'), null);
  assert.equal(parseAppId(''), null);
  assert.equal(parseAppId(undefined), null);
});

test('parseAppId: non-numeric steam:// link is rejected, not partially matched', () => {
  assert.equal(parseAppId('steam://run/abc'), null);
});

test('normalizeExecutable: backslashes become forward slashes and result is lowercased', () => {
  assert.equal(normalizeExecutable('Bin\\Win64\\Game.EXE'), 'bin/win64/game.exe');
});

test('normalizeExecutable: leading "./" and leading slashes are stripped', () => {
  assert.equal(normalizeExecutable('./game.exe'), 'game.exe');
  assert.equal(normalizeExecutable('///game.exe'), 'game.exe');
});

test('normalizeExecutable: a ".." path segment is rejected (path traversal)', () => {
  assert.equal(normalizeExecutable('../../etc/passwd'), null);
  assert.equal(normalizeExecutable('sub/../../escape.exe'), null);
});

test('normalizeExecutable: empty or whitespace-only input returns null', () => {
  assert.equal(normalizeExecutable(''), null);
  assert.equal(normalizeExecutable('   '), null);
  assert.equal(normalizeExecutable(undefined), null);
});

test('executablesInArguments: extracts game binaries from a bootstrapper launch string', () => {
  assert.deepEqual(
    executablesInArguments('--fullscreen cod26-cod.exe --nolauncher'),
    ['cod26-cod.exe']
  );
});

test('executablesInArguments: switches that merely look like files are excluded', () => {
  // Counter-Strike 2 really does pass "-steam.exe" as a launch argument.
  assert.deepEqual(executablesInArguments('-steam.exe -nojoy'), []);
});

test('executablesInArguments: tokens containing "=" are excluded', () => {
  assert.deepEqual(executablesInArguments('config=game.exe'), []);
});

test('executablesInArguments: no matches returns an empty array, not null/undefined', () => {
  assert.deepEqual(executablesInArguments(''), []);
  assert.deepEqual(executablesInArguments(undefined), []);
});

test('osKeysFor: reads Steam\'s own oslist when present', () => {
  assert.deepEqual(osKeysFor({ config: { oslist: 'windows,macos' } }, ''), ['win32', 'darwin']);
});

test('osKeysFor: falls back to the executable extension when oslist is empty', () => {
  assert.deepEqual(osKeysFor({ executable: 'Game.app' }, ''), ['darwin']);
  assert.deepEqual(osKeysFor({ executable: 'game.sh' }, ''), ['linux']);
  assert.deepEqual(osKeysFor({ executable: 'game.exe' }, ''), ['win32']);
});

test('osKeysFor: defaults to win32 when nothing else indicates a platform', () => {
  assert.deepEqual(osKeysFor({ executable: 'game' }, ''), ['win32']);
});
