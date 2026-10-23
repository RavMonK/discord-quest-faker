'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

/**
 * Self-update on launch: a `git pull --ff-only` with every way it can go wrong turned into a
 * reason to skip instead of a failure. The checkout is the user's, so nothing here ever
 * discards a local change: a dirty tree, a local commit, a detached HEAD, or a branch that has
 * diverged from its upstream all leave the files exactly as they are and say so.
 *
 * Only a git clone can update itself. A ZIP download has no .git and is told where the
 * releases live instead.
 */

const FETCH_TIMEOUT_MS = 20000;
const RELEASES_URL = 'https://github.com/RavMonK/discord-quest-faker/releases';

function gitRunner(root) {
  return (args, options) => {
    const timeout = (options && options.timeout) || 10000;
    try {
      const out = execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        timeout,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return { ok: true, out: out.trim() };
    } catch (err) {
      return {
        ok: false,
        code: err.code,
        out: String(err.stdout || '').trim(),
        err: String(err.stderr || err.message || '').trim()
      };
    }
  };
}

function readVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '';
  } catch (err) {
    return '';
  }
}

/**
 * Work out whether the checkout can be fast-forwarded, and do it. Pure given `run`, so a test
 * can play every branch of it with a stub instead of a real repository.
 *
 * Returns { status, ...detail } where status is one of:
 *   'updated'      - HEAD moved; the caller must re-run the program on the new code
 *   'current'      - already at the upstream commit
 *   'skipped'      - not a git checkout / no git / nothing to track; `reason` says why
 *   'local'        - the user has local changes or commits; `reason` says which
 *   'offline'      - the fetch failed (no network, remote down); `reason` has git's words
 *   'diverged'     - upstream and local history both moved; left for the user to sort out
 *   'failed'       - the fast-forward itself failed; `reason` has git's words
 */
function planAndApply({ root, run, hasGitDir = fs.existsSync(path.join(root, '.git')) }) {
  if (!hasGitDir) {
    return { status: 'skipped', reason: 'not a git checkout - get new releases from ' + RELEASES_URL };
  }

  const version = run(['--version']);
  if (!version.ok) return { status: 'skipped', reason: 'git is not installed' };

  // `@{u}` resolves only on a branch that tracks a remote one; a detached HEAD or a branch
  // with no upstream has nothing to update from.
  const upstream = run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok || !upstream.out) {
    return { status: 'skipped', reason: 'the current branch tracks no remote branch' };
  }

  // Tracked files with edits. Untracked files are fine - config.json and data/ are gitignored
  // anyway, and a fast-forward never touches a file git does not know about.
  const dirty = run(['status', '--porcelain', '--untracked-files=no']);
  if (!dirty.ok) return { status: 'skipped', reason: 'git status failed: ' + dirty.err };
  if (dirty.out) {
    return { status: 'local', reason: 'you have uncommitted changes - commit or stash them to update' };
  }

  const fetched = run(['fetch', '--quiet'], { timeout: FETCH_TIMEOUT_MS });
  if (!fetched.ok) {
    const reason = fetched.code === 'ETIMEDOUT' ? 'fetch timed out after ' + (FETCH_TIMEOUT_MS / 1000) + ' s'
      : (fetched.err.split('\n').pop() || 'fetch failed');
    return { status: 'offline', reason };
  }

  // "<behind>\t<ahead>" relative to upstream
  const counts = run(['rev-list', '--left-right', '--count', '@{u}...HEAD']);
  if (!counts.ok) return { status: 'skipped', reason: 'could not compare with ' + upstream.out};
  const [behind, ahead] = counts.out.split(/\s+/).map(Number);

  if (ahead > 0 && behind > 0) {
    return { status: 'diverged', upstream: upstream.out, behind, ahead,
      reason: 'your branch and ' + upstream.out + ' have both moved - merge or rebase by hand' };
  }
  if (ahead > 0) {
    return { status: 'local', ahead, reason: 'you have ' + ahead + ' local commit(s) ' + upstream.out + ' does not - not touching them' };
  }
  if (behind === 0) return { status: 'current', upstream: upstream.out };

  const before = readVersion(root);
  const merged = run(['merge', '--ff-only', '--quiet', '@{u}']);
  if (!merged.ok) return { status: 'failed', reason: merged.err.split('\n').pop() || 'fast-forward failed' };

  const log = run(['log', '--oneline', 'HEAD@{1}..HEAD']);
  return {
    status: 'updated',
    upstream: upstream.out,
    behind,
    from: before,
    to: readVersion(root),
    log: log.ok ? log.out.split('\n').filter(Boolean) : []
  };
}

function describe(result) {
  switch (result.status) {
    case 'updated': {
      const versions = result.from && result.to && result.from !== result.to
        ? ' (' + result.from + ' -> ' + result.to + ')' : '';
      return ['[update] pulled ' + result.behind + ' commit(s) from ' + result.upstream + versions]
        .concat(result.log.slice(0, 10).map((line) => '         ' + line))
        .concat(result.log.length > 10 ? ['         ... and ' + (result.log.length - 10) + ' more'] : []);
    }
    case 'current': return ['[update] up to date with ' + result.upstream];
    case 'offline': return ['[update] could not reach the remote (' + result.reason + ') - running the current version'];
    case 'diverged':
    case 'local':
    case 'failed':
    case 'skipped':
    default:
      return ['[update] not updating: ' + result.reason];
  }
}

/**
 * Pull, and when something came in, run the program again on the new files. Every module was
 * already require()d by then, so the only way to execute the new code is a fresh process: it
 * inherits the terminal, this one waits for it and exits with its status.
 */
function selfUpdate({ root, argv, log = console.log, run = gitRunner(root) }) {
  const result = planAndApply({ root, run });
  describe(result).forEach((line) => log(line));
  if (result.status !== 'updated') return result;

  log('[update] restarting on the new version\n');
  // Ctrl+C reaches both processes; the child does the real shutdown, this one just waits.
  const ignore = () => {};
  process.on('SIGINT', ignore);
  process.on('SIGTERM', ignore);
  const child = spawnSync(process.execPath, [path.join(root, 'src', 'index.js'), ...argv, '--no-update'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  process.exit(child.status === null ? 1 : child.status);
}

module.exports = { selfUpdate, planAndApply, describe, gitRunner, RELEASES_URL, FETCH_TIMEOUT_MS };
