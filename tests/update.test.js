'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { planAndApply, describe } = require('../src/update');

/**
 * planAndApply() drives git through its `run` argument, so every outcome can be played with a
 * scripted stub and no repository, network, or merge is involved. A step not in the script is a
 * bug in the plan (it asked git something it should not have), so the stub throws on it.
 */
function stub(script) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(' '));
    const key = args[0] === 'rev-parse' ? 'upstream' : args[0] === 'rev-list' ? 'counts' : args[0];
    if (!(key in script)) throw new Error('unexpected git call: ' + args.join(' '));
    const reply = script[key];
    return typeof reply === 'function' ? reply(args) : reply;
  };
  return { run, calls };
}

const ok = (out = '') => ({ ok: true, out });
const fail = (err = '', code) => ({ ok: false, out: '', err, code });

const clean = {
  '--version': ok('git version 2.45.0'),
  upstream: ok('origin/main'),
  status: ok(''),
  fetch: ok(''),
  counts: ok('0\t0')
};

function withTempRoot(version, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-update-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('update: a ZIP download (no .git) is skipped before git is even asked', () => {
  const { run, calls } = stub({});
  const result = planAndApply({ root: '/nowhere', run, hasGitDir: false });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /releases/);
  assert.deepEqual(calls, []);
});

test('update: no git binary is skipped quietly', () => {
  const { run } = stub({ '--version': fail('spawn git ENOENT', 'ENOENT') });
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /git is not installed/);
});

test('update: a detached HEAD or untracked branch has nothing to update from', () => {
  const { run, calls } = stub(Object.assign({}, clean, { upstream: fail('fatal: no upstream configured') }));
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'skipped');
  assert.ok(!calls.some((c) => c.startsWith('fetch')), 'must not fetch without an upstream');
});

test('update: uncommitted edits stop the update before the fetch', () => {
  const { run, calls } = stub(Object.assign({}, clean, { status: ok(' M src/spoof.js') }));
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'local');
  assert.match(result.reason, /uncommitted/);
  assert.ok(!calls.some((c) => c.startsWith('fetch')));
});

test('update: a failed fetch reports offline and leaves the checkout alone', () => {
  const { run, calls } = stub(Object.assign({}, clean, {
    fetch: fail('fatal: unable to access \'https://github.com/\': Could not resolve host: github.com')
  }));
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'offline');
  assert.match(result.reason, /Could not resolve host/);
  assert.ok(!calls.some((c) => c.startsWith('merge')));
});

test('update: a fetch timeout is named as such', () => {
  const { run } = stub(Object.assign({}, clean, { fetch: fail('', 'ETIMEDOUT') }));
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'offline');
  assert.match(result.reason, /timed out/);
});

test('update: already at upstream is "current" and never merges', () => {
  const { run, calls } = stub(clean);
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'current');
  assert.equal(result.upstream, 'origin/main');
  assert.ok(!calls.some((c) => c.startsWith('merge')));
});

test('update: local commits ahead of upstream are left alone', () => {
  const { run, calls } = stub(Object.assign({}, clean, { counts: ok('0\t2') }));
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'local');
  assert.equal(result.ahead, 2);
  assert.ok(!calls.some((c) => c.startsWith('merge')));
});

test('update: diverged history is reported, not merged', () => {
  const { run, calls } = stub(Object.assign({}, clean, { counts: ok('3\t1') }));
  const result = planAndApply({ root: '/x', run, hasGitDir: true });
  assert.equal(result.status, 'diverged');
  assert.ok(!calls.some((c) => c.startsWith('merge')));
});

test('update: behind upstream fast-forwards and reports the version change', () => {
  withTempRoot('1.7.0', (root) => {
    const { run, calls } = stub(Object.assign({}, clean, {
      counts: ok('2\t0'),
      merge: (args) => {
        assert.ok(args.includes('--ff-only'), 'must be a fast-forward only merge');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.8.0' }));
        return ok('');
      },
      log: ok('abc1234 Release 1.8.0\ndef5678 Fix something')
    }));
    const result = planAndApply({ root, run, hasGitDir: true });
    assert.equal(result.status, 'updated');
    assert.equal(result.behind, 2);
    assert.equal(result.from, '1.7.0');
    assert.equal(result.to, '1.8.0');
    assert.deepEqual(result.log, ['abc1234 Release 1.8.0', 'def5678 Fix something']);
    assert.ok(calls.some((c) => c.startsWith('merge --ff-only')));

    const lines = describe(result);
    assert.match(lines[0], /pulled 2 commit\(s\) from origin\/main \(1\.7\.0 -> 1\.8\.0\)/);
    assert.equal(lines.length, 3);
  });
});

test('update: a refused fast-forward is "failed" with git\'s words', () => {
  withTempRoot('1.7.0', (root) => {
    const { run } = stub(Object.assign({}, clean, {
      counts: ok('1\t0'),
      merge: fail('fatal: Not possible to fast-forward, aborting.')
    }));
    const result = planAndApply({ root, run, hasGitDir: true });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /Not possible to fast-forward/);
  });
});

test('update: describe() gives one line for every non-updated status', () => {
  for (const status of ['current', 'offline', 'diverged', 'local', 'failed', 'skipped']) {
    const lines = describe({ status, reason: 'why', upstream: 'origin/main' });
    assert.equal(lines.length, 1, status);
    assert.match(lines[0], /^\[update\] /);
  }
});
