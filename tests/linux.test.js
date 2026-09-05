'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { spawn, spawnSync } = require('child_process');
const { Spoofer } = require('../src/spoof');

// The windowed tier needs a compiler to build it and a display to put the window on.
const windowed = process.platform === 'linux' && !!process.env.DISPLAY && !!Spoofer.linuxCompiler();

/** Hide the display for one test, which is what sends a session down to a windowless tier. */
function withoutDisplay(t) {
  const display = process.env.DISPLAY;
  delete process.env.DISPLAY;
  t.after(() => { if (display !== undefined) process.env.DISPLAY = display; });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-linux-'));
  const spoofer = new Spoofer({ runtimePath: root, maxConcurrent: 2, defaultDurationMinutes: 0 });
  t.after(() => {
    spoofer.stopAll(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return spoofer;
}

test('Linux: system placeholder runs at its game path and stops on request', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  withoutDisplay(t); // no display means no windowed tier, which is what puts `system` first
  const spoofer = fixture(t);
  const game = { id: 'linux-smoke', name: 'Linux smoke', executables: [{ name: 'bin/audit-game', os: 'linux' }] };
  const result = spoofer.start(game, {});
  assert.equal(result.ok, true, result.reason);
  const info = result.sessions[0];
  const session = spoofer.running.get(info.key);
  const exited = once(session.child, 'exit');
  assert.equal(info.placeholder, 'system');
  assert.equal(fs.realpathSync('/proc/' + info.pid + '/exe'), info.path);
  assert.equal(Spoofer.fileHash(info.path), Spoofer.fileHash('/bin/sleep'));
  assert.equal(fs.statSync(info.path).nlink, 1);
  assert.equal(spoofer.start(game, {}).ok, false);
  spoofer.stop(info.key);
  await exited;
  assert.equal(spoofer.list().length, 0);
  assert.equal(fs.existsSync('/proc/' + info.pid), false);
});

test('Linux: duration timer stops a real placeholder', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  withoutDisplay(t); // a test suite should not flash a window on screen for a timer check
  const spoofer = fixture(t);
  const game = { id: 'linux-timer', name: 'Linux timer', executables: [{ name: 'timer-game', os: 'linux' }] };
  const result = spoofer.start(game, { durationMinutes: 0.003 });
  assert.equal(result.ok, true, result.reason);
  const info = result.sessions[0];
  const child = spoofer.running.get(info.key).child;
  await once(child, 'exit');
  assert.equal(spoofer.list().length, 0);
  assert.equal(fs.existsSync('/proc/' + info.pid), false);
});

test('Linux: Node fallback replaces tampered bytes and launches keepalive', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const spoofer = fixture(t);
  const game = { id: 'linux-node', name: 'Node fallback' };
  const exe = { name: 'node-game', os: 'linux' };
  const target = spoofer.materialize(game, exe);
  // Same length as Node but deliberately not executable code; it must never be reused.
  const fd = fs.openSync(target, 'w');
  fs.ftruncateSync(fd, fs.statSync(process.execPath).size);
  fs.closeSync(fd);
  const plan = spoofer.provision(target, 'node', game, exe, {});
  assert.equal(Spoofer.fileHash(target), Spoofer.fileHash(process.execPath));
  const child = spawn(target, plan.args, { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  const deadline = Date.now() + 3000;
  while (fs.readFileSync('/proc/' + child.pid + '/cmdline', 'utf8').split('\0')[0] !== 'node-game') {
    assert.ok(Date.now() < deadline, 'keepalive did not set the process title');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(fs.realpathSync('/proc/' + child.pid + '/exe'), target);
  child.kill('SIGTERM');
  await exited;
});

test('Linux: no display means no compiled placeholder, rather than one that cannot appear', { skip: process.platform !== 'linux' }, t => {
  withoutDisplay(t);
  const spoofer = fixture(t);
  const game = { id: 'linux-headless', name: 'Headless' };
  const target = spoofer.materialize(game, { name: 'headless-game', os: 'linux' });
  assert.throws(() => spoofer.compileLinux(target, game), /no X display/);
  assert.equal(fs.existsSync(target), false); // nothing half-built was left behind
});

test('Linux: the compiled placeholder owns a real X window at the game path', { skip: !windowed, timeout: 60000 }, async t => {
  const spoofer = fixture(t);
  const game = { id: 'linux-window', name: 'Window smoke', executables: [{ name: 'bin/window-game', os: 'linux' }] };
  const result = spoofer.start(game, { durationMinutes: 0 });
  assert.equal(result.ok, true, result.reason);

  const info = result.sessions[0];
  const session = spoofer.running.get(info.key);
  const exited = once(session.child, 'exit');
  assert.equal(info.placeholder, 'compiled');
  assert.equal(fs.realpathSync('/proc/' + info.pid + '/exe'), info.path);
  assert.equal(fs.statSync(info.path).nlink, 1);

  // The window is the entire point of this tier, so ask the X server whether it is really
  // there - but only where the tools to ask with are installed.
  if (spawnSync('xwininfo', ['-version'], { encoding: 'utf8' }).status === 0) {
    const wanted = /"Window smoke": \("window-game" "Window smoke"\)\s+480x160/;
    const deadline = Date.now() + 10000;
    let tree = '';
    do {
      tree = String(spawnSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8' }).stdout || '');
      if (wanted.test(tree)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.match(tree, wanted, 'the placeholder mapped no window');
  }

  spoofer.stop(info.key);
  await exited;
  assert.equal(spoofer.list().length, 0);
  assert.equal(fs.existsSync('/proc/' + info.pid), false);
});
