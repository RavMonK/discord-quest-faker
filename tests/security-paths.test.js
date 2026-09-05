'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Spoofer } = require('../src/spoof');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const spoofer = new Spoofer({ runtimePath: path.join(root, 'runtime') });
  return { root, spoofer };
}

test('paths: rejects dot IDs and traversal before creating files outside runtime', t => {
  const { root, spoofer } = fixture(t);
  const sentinel = path.join(root, 'sentinel');
  fs.writeFileSync(sentinel, 'unchanged');
  for (const id of ['.', '..', '', '../escape', 'steam:../escape', 'CON', 'id.']) {
    assert.throws(() => spoofer.materialize({ id }, { name: 'sentinel', os: 'linux' }), /unsafe/);
  }
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
  for (const name of ['../sentinel', 'sub/../../sentinel', '.. /sentinel', 'C:\\sentinel', '...app', '..app', '.app']) {
    assert.throws(() => spoofer.materialize({ id: '42' }, { name, os: 'darwin' }), /unsafe/);
  }
  assert.equal(Spoofer.gameDirectory('steam:42'), 'steam_42');
  assert.equal(Spoofer.gameDirectory('custom-game'), 'custom-game');
});

test('paths: rejects symlinked game directories and bundle contents', { skip: process.platform === 'win32' }, t => {
  const { root, spoofer } = fixture(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(spoofer.config.runtimePath, '42'));
  assert.throws(() => spoofer.materialize({ id: '42' }, { name: 'nested/game', os: 'linux' }), /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
  const bundle = path.join(spoofer.config.runtimePath, '43', 'Game.app');
  fs.mkdirSync(bundle, { recursive: true });
  fs.symlinkSync(outside, path.join(bundle, 'Contents'));
  assert.throws(() => spoofer.materialize({ id: '43' }, { name: 'Game.app', os: 'darwin' }), /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('binary: replaces a same-size altered file, reuses verified bytes and never hardlinks source', t => {
  const { root, spoofer } = fixture(t);
  const source = path.join(root, 'source');
  fs.writeFileSync(source, 'TRUSTED');
  const target = spoofer.materialize({ id: '42' }, { name: 'game', os: 'linux' });
  fs.writeFileSync(target, 'CHANGED');
  spoofer.copyBinary(source, target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'TRUSTED');
  const before = fs.statSync(target);
  assert.equal(before.nlink, 1);
  spoofer.copyBinary(source, target);
  assert.equal(fs.statSync(target).mtimeMs, before.mtimeMs);
  fs.writeFileSync(target, 'CHANGED');
  assert.equal(fs.readFileSync(source, 'utf8'), 'TRUSTED');
});

test('binary: retires old hardlinks and rejects a symlink target', { skip: process.platform === 'win32' }, t => {
  const { root, spoofer } = fixture(t);
  const source = path.join(root, 'source');
  fs.writeFileSync(source, 'TRUSTED');
  const target = spoofer.materialize({ id: '42' }, { name: 'game', os: 'linux' });
  fs.linkSync(source, target);
  spoofer.copyBinary(source, target);
  assert.notEqual(fs.statSync(source).ino, fs.statSync(target).ino);
  fs.unlinkSync(target);
  fs.symlinkSync(source, target);
  assert.throws(() => spoofer.copyBinary(source, target), /symlink/);
});

test('binary: fails closed when replacement fails, even when target exists', t => {
  const { root, spoofer } = fixture(t);
  const source = path.join(root, 'source');
  fs.writeFileSync(source, 'TRUSTED');
  const target = spoofer.materialize({ id: '42' }, { name: 'game', os: 'linux' });
  fs.writeFileSync(target, 'CHANGED');
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); });
  assert.throws(() => spoofer.copyBinary(source, target), /locked/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'CHANGED');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['game']);
});

test('compiled cache: rejects same-size tampering and untrusted stamps after restart', t => {
  const { spoofer } = fixture(t);
  const target = spoofer.materialize({ id: '42' }, { name: 'game', os: 'linux' });
  fs.writeFileSync(target, 'TRUSTED');
  spoofer.rememberCompiled(target, 'Game');
  assert.equal(spoofer.compiledMatches(target, 'Game'), true);
  assert.equal(spoofer.compiledMatches(target, 'Other'), false);
  fs.writeFileSync(target, 'CHANGED');
  assert.equal(spoofer.compiledMatches(target, 'Game'), false);
  const restarted = new Spoofer(spoofer.config);
  assert.equal(restarted.compiledMatches(target, 'Game'), false);
});
