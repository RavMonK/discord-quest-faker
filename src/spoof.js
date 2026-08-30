'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFile } = require('child_process');
const { OS_KEY } = require('./games');

const KEEPALIVE_SOURCE = [
  '// Placeholder process for Discord game detection.',
  '// It does nothing but stay alive so the (renamed) executable stays in the process list.',
  "process.title = process.argv[2] || 'game';",
  'setInterval(function () {}, 1 << 30);',
  "process.on('SIGTERM', function () { process.exit(0); });",
  "process.on('SIGINT', function () { process.exit(0); });",
  ''
].join('\n');

// A session keeps running until it is stopped, so a placeholder that ends on its own is
// replaced. The cap only exists so a permanently broken placeholder cannot spin forever.
const MAX_RESTARTS = 500;

/**
 * Discord detects games by reading the executable path of every running process and matching
 * it against the "executables" entries of the detectable list. To look like a game is running
 * we only need a long-lived process whose path ends with that exact name.
 *
 * We get one by copying the Node binary we are already running to
 *   data/runtime/<app id>/<executable name>
 * and launching it with a script that sleeps forever.
 */
class Spoofer {
  constructor(config) {
    this.config = config;
    this.running = new Map(); // application id -> session
    this.keepalivePath = path.join(config.runtimePath, 'keepalive.js');
    fs.mkdirSync(config.runtimePath, { recursive: true });
    fs.writeFileSync(this.keepalivePath, KEEPALIVE_SOURCE, 'utf8');
  }

  /**
   * How the fake executable gets made, best first.
   *
   * "compiled" builds a real 4 KB program with csc.exe (part of the .NET Framework that ships
   * with Windows) whose version info carries the game's own name. That matters: a renamed copy
   * of waitfor.exe still tells Windows it is "waitfor.exe by Microsoft Corporation", which is
   * what Task Manager shows and what anything inspecting the file sees.
   *
   * The copy-based tiers stay as fallbacks for machines without csc.
   */
  static tiers() {
    return process.platform === 'win32'
      ? ['compiled', 'system', 'node']
      : ['system', 'node'];
  }

  static cscPath() {
    const root = process.env.WINDIR || 'C:\\Windows';
    const candidates = [
      path.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      path.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  /**
   * Fallbacks for machines without csc. These keep a process with the right name alive but
   * own no window, so Discord may not pick them up - the compiled tier is the one that works.
   */
  static systemBinary() {
    if (process.platform === 'win32') {
      const waitfor = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'waitfor.exe');
      // waitfor refuses a signal name that is already being waited on, so every session needs
      // its own - otherwise only the first executable of a game survives.
      return fs.existsSync(waitfor)
        ? { source: waitfor, args: (token) => ['/t', '99999', token] }
        : null;
    }
    return fs.existsSync('/bin/sleep') ? { source: '/bin/sleep', args: () => ['999999'] } : null;
  }

  /** C# string literal contents - the game name is arbitrary text from an API. */
  static csharpString(text) {
    return String(text || 'Game')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .slice(0, 120);
  }

  /**
   * Compile the placeholder straight to its final path, so the version info Windows reads
   * (OriginalFilename) is the game's executable name rather than a borrowed one.
   */
  compile(target, displayName) {
    const csc = Spoofer.cscPath();
    if (!csc) throw new Error('csc.exe (.NET Framework) not found');

    const buildDir = path.join(this.config.runtimePath, '_build');
    fs.mkdirSync(buildDir, { recursive: true });

    const name = Spoofer.csharpString(displayName);
    const stampPath = path.join(buildDir, Spoofer.signalToken('b', target) + '.json');

    // Rebuilding costs ~800ms, so skip it when this exact file was already built for this name.
    if (fs.existsSync(target) && fs.existsSync(stampPath)) {
      try {
        const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
        if (stamp.name === name && stamp.size === fs.statSync(target).size) return target;
      } catch (err) { /* rebuild */ }
    }

    const sourcePath = path.join(buildDir, Spoofer.signalToken('s', target) + '.cs');
    const fileName = Spoofer.csharpString(path.basename(target));

    // The window is the point: Discord's detection wants a process that owns a real, visible
    // window with a running message loop, not just a process with a matching executable name.
    fs.writeFileSync(sourcePath, '\ufeff' + [
      'using System;',
      'using System.Drawing;',
      'using System.Reflection;',
      'using System.Windows.Forms;',
      '',
      '[assembly: AssemblyTitle("' + name + '")]',
      '[assembly: AssemblyProduct("' + name + '")]',
      '[assembly: AssemblyCompany("' + name + '")]',
      '[assembly: AssemblyDescription("' + name + '")]',
      '[assembly: AssemblyFileVersion("1.0.0.0")]',
      '',
      'internal static class Placeholder',
      '{',
      '    [STAThread]',
      '    private static void Main()',
      '    {',
      '        Application.EnableVisualStyles();',
      '',
      '        Form form = new Form();',
      '        form.Text = "' + name + '";',
      '        form.ClientSize = new Size(430, 132);',
      '        form.StartPosition = FormStartPosition.CenterScreen;',
      '        form.FormBorderStyle = FormBorderStyle.FixedSingle;',
      '        form.MaximizeBox = false;',
      '        form.BackColor = Color.FromArgb(35, 36, 40);',
      '',
      '        Label title = new Label();',
      '        title.Text = "' + name + '";',
      '        title.Font = new Font("Segoe UI", 13F, FontStyle.Bold);',
      '        title.ForeColor = Color.White;',
      '        title.SetBounds(0, 22, 430, 30);',
      '        title.TextAlign = ContentAlignment.MiddleCenter;',
      '',
      '        Label note = new Label();',
      '        note.Text = "' + fileName + '\\r\\nDiscord Quest Faker placeholder - keep this window open.";',
      '        note.Font = new Font("Segoe UI", 9F);',
      '        note.ForeColor = Color.FromArgb(154, 160, 168);',
      '        note.SetBounds(0, 58, 430, 50);',
      '        note.TextAlign = ContentAlignment.MiddleCenter;',
      '',
      '        form.Controls.Add(title);',
      '        form.Controls.Add(note);',
      '        Application.Run(form);',
      '    }',
      '}',
      ''
    ].join('\n'), 'utf8');

    try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (err) { /* locked, csc will tell us */ }

    const result = spawnSync(csc, [
      '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
      '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
      '/out:' + target, sourcePath
    ], { windowsHide: true, timeout: 30000, encoding: 'utf8' });

    if (result.status !== 0 || !fs.existsSync(target)) {
      throw new Error('csc failed: ' + String(result.stderr || result.stdout || result.error || '').trim().split('\n')[0]);
    }

    fs.writeFileSync(stampPath, JSON.stringify({ name, size: fs.statSync(target).size }), 'utf8');
    return target;
  }

  /** Alphanumeric, unique per game+executable - waitfor signal names allow nothing else. */
  static signalToken(gameId, executableName) {
    let hash = 5381;
    for (let i = 0; i < executableName.length; i += 1) {
      hash = ((hash * 33) ^ executableName.charCodeAt(i)) >>> 0;
    }
    return 'DQF' + String(gameId).replace(/[^0-9a-z]/gi, '') + hash.toString(36);
  }

  /** One session per executable, so the same game can run several of them at once. */
  static sessionKey(gameId, executableName) {
    return String(gameId) + '::' + executableName;
  }

  /** Executables usable on this machine, de-duplicated, launchers last. */
  static candidates(game, osKey = OS_KEY) {
    const seen = new Set();
    return (game.executables || [])
      .filter((exe) => {
        if (exe.os !== osKey) return false;
        const name = exe.name.toLowerCase();
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .sort((a, b) => Number(a.isLauncher) - Number(b.isLauncher));
  }

  /** Resolve whatever the caller asked for ("all", a name, an index) to a list of executables. */
  static select(game, wanted) {
    const candidates = Spoofer.candidates(game);
    if (candidates.length === 0) return [];
    if (wanted === undefined || wanted === null || wanted === '') return [candidates[0]];
    if (wanted === 'all' || wanted === true) return candidates;

    if (typeof wanted === 'number' || /^\d+$/.test(String(wanted))) {
      const index = Number(wanted);
      return index >= 0 && index < candidates.length ? [candidates[index]] : [];
    }

    const names = (Array.isArray(wanted) ? wanted : [wanted]).map((n) => String(n).toLowerCase());
    return candidates.filter((exe) => names.includes(exe.name.toLowerCase()));
  }

  /**
   * Create the fake executable on disk and return its path.
   * The directory prefix from the API ("_retail_/wow-64.exe") is recreated because Discord
   * matches the tail of the full path, not just the file name.
   */
  materialize(game, exe) {
    const relative = exe.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const dir = path.posix.dirname(relative);
    const base = path.posix.basename(relative);
    // custom ids look like "steam:3787240" and executable names come from a third party,
    // so keep both away from the file system's sharp edges
    const gameDirName = String(game.id).replace(/[^0-9a-zA-Z._-]/g, '_');
    const parents = (dir === '.' ? [] : dir.split('/')).filter((p) => p && p !== '.' && p !== '..');
    let target;

    if (exe.os === 'darwin' && base.toLowerCase().endsWith('.app')) {
      // macOS entries point at an app bundle, so recreate a minimal one: the running process
      // path then ends with Foo.app/Contents/MacOS/Foo exactly like the real game.
      const binaryName = base.slice(0, -4);
      const bundleDir = path.join(this.config.runtimePath, gameDirName, ...parents, base);
      const macosDir = path.join(bundleDir, 'Contents', 'MacOS');
      fs.mkdirSync(macosDir, { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'Contents', 'Info.plist'), [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        '  <key>CFBundleExecutable</key><string>' + binaryName + '</string>',
        '  <key>CFBundleName</key><string>' + binaryName + '</string>',
        '  <key>CFBundleIdentifier</key><string>com.discordquestfaker.g' + game.id + '</string>',
        '  <key>CFBundlePackageType</key><string>APPL</string>',
        '  <key>LSBackgroundOnly</key><true/>',
        '</dict></plist>'
      ].join('\n'), 'utf8');
      target = path.join(macosDir, binaryName);
    } else {
      const gameDir = path.join(this.config.runtimePath, gameDirName, ...parents);
      fs.mkdirSync(gameDir, { recursive: true });
      target = path.join(gameDir, base);
    }

    return target;
  }

  /**
   * Put a working placeholder at `target` using the given tier and return the arguments it
   * needs. Throws if this tier cannot be used, which makes the caller try the next one.
   */
  provision(target, tier, game, exe) {
    if (tier === 'compiled') {
      this.compile(target, game.name);
      // A windowed app only quits when its window is closed, so that counts as a stop.
      return { args: [], hasWindow: true, hideWindow: false, restartOnExit: false };
    }

    if (tier === 'system') {
      const binary = Spoofer.systemBinary();
      if (!binary) throw new Error('no system placeholder available');
      this.copyBinary(binary.source, target);
      return {
        args: binary.args(Spoofer.signalToken(game.id, exe.name)),
        hasWindow: false,
        hideWindow: true,
        restartOnExit: true // waitfor/sleep time out eventually, the session should not
      };
    }

    this.copyBinary(process.execPath, target);
    return {
      args: [this.keepalivePath, path.basename(target)],
      hasWindow: false,
      hideWindow: true,
      restartOnExit: true
    };
  }

  /**
   * Put a runnable copy of `source` at `target`.
   * A hard link costs no disk space, so it is tried first; copying is the fallback when the
   * source lives on another volume or in a directory we may not link from (Program Files).
   */
  copyBinary(source, target) {
    const sourceStat = fs.statSync(source);

    if (fs.existsSync(target)) {
      const targetStat = fs.statSync(target);
      const same = targetStat.ino !== 0 && targetStat.ino === sourceStat.ino;
      if (same || targetStat.size === sourceStat.size) return target; // already usable
      try { fs.unlinkSync(target); } catch (err) { return target; /* locked = in use */ }
    }

    try {
      fs.linkSync(source, target);
    } catch (linkErr) {
      try {
        fs.copyFileSync(source, target);
      } catch (copyErr) {
        // A previous copy may still be locked by a running process on Windows - reuse it.
        if (!fs.existsSync(target)) {
          throw new Error('could not create fake executable: ' + copyErr.message);
        }
      }
    }

    if (process.platform !== 'win32') {
      try { fs.chmodSync(target, 0o755); } catch (err) { /* best effort */ }
    }
    return target;
  }

  /**
   * Start one or more executables of a game.
   * `options.executable` accepts "all", an executable name (or array of names), an index, or
   * nothing at all (which starts the first non-launcher executable).
   * @param {object} game normalized entry from the game store
   */
  start(game, options) {
    const opts = options || {};
    const wanted = Spoofer.select(game, opts.executable);

    if (wanted.length === 0) {
      const hasAny = Spoofer.candidates(game).length > 0;
      return {
        ok: false,
        reason: hasAny
          ? 'no executable of ' + game.name + ' matched ' + JSON.stringify(opts.executable)
          : game.name + ' has no ' + OS_KEY + ' executable in the detectable list'
      };
    }

    const results = wanted.map((exe) => this.startOne(game, exe, opts));
    const started = results.filter((r) => r.ok);

    return {
      ok: started.length > 0,
      reason: started.length ? undefined : results[0].reason,
      sessions: started.map((r) => r.session),
      results
    };
  }

  /** Launch a single executable of a game. */
  startOne(game, exe, opts) {
    const key = Spoofer.sessionKey(game.id, exe.name);
    if (this.running.has(key)) {
      return { ok: false, executable: exe.name, reason: exe.name + ' is already running' };
    }
    if (this.running.size >= this.config.maxConcurrent) {
      return {
        ok: false,
        executable: exe.name,
        reason: 'limit reached (maxConcurrent = ' + this.config.maxConcurrent + ')'
      };
    }

    const requested = opts.durationMinutes === undefined || opts.durationMinutes === null
      ? this.config.defaultDurationMinutes
      : opts.durationMinutes;

    const session = {
      key,
      gameId: game.id,
      name: game.name,
      icon: game.icon || null,
      executable: exe.name,
      path: null,
      pid: null,
      startedAt: Date.now(),
      durationMinutes: Number(requested) > 0 ? Number(requested) : 0,
      child: null,
      timer: null,
      stopping: false,
      tier: null,
      launchedAt: 0,
      restarts: 0
    };

    const label = game.name + ' / ' + exe.name;
    const tiers = Spoofer.tiers();

    /** Try each tier in turn; the first one that spawns wins. Returns the tier used. */
    const launch = (fromTier) => {
      const fakePath = this.materialize(game, exe);
      let lastError = null;

      for (let i = fromTier; i < tiers.length; i += 1) {
        let plan;
        try {
          plan = this.provision(fakePath, tiers[i], game, exe);
        } catch (err) {
          lastError = err;
          console.error('[spoof] ' + label + ': ' + tiers[i] + ' placeholder unavailable (' + err.message + ')');
          continue;
        }

        const child = spawn(fakePath, plan.args, {
          cwd: path.dirname(fakePath),
          stdio: 'ignore',
          // the compiled placeholder must show its window - that is what Discord looks for
          windowsHide: plan.hideWindow,
          detached: false
        });

        if (!plan.hasWindow && process.platform === 'win32') {
          console.warn('[spoof] ' + label + ': the ' + tiers[i] + ' placeholder has no window, '
            + 'so Discord may not detect it (install the .NET Framework so csc.exe is available)');
        }

        session.path = fakePath;
        session.pid = child.pid;
        session.child = child;
        session.tier = i;
        session.launchedAt = Date.now();

        child.on('error', (err) => {
          if (session.child !== child || session.stopping) return;
          console.error('[spoof] ' + label + ': ' + tiers[i] + ' placeholder failed to start (' + err.message + ')');
          if (!retry(i + 1)) this.cleanup(session);
        });

        child.on('exit', (code, signal) => {
          if (session.child !== child) return; // superseded by another launch
          if (session.stopping) {
            this.cleanup(session);
            return;
          }

          const aliveMs = Date.now() - session.launchedAt;

          // A placeholder that dies at once was refused (policy, a bad argument) rather than
          // stopped - move down to the next tier instead of giving up.
          if (aliveMs < 2000 && code !== 0) {
            console.error('[spoof] ' + label + ': ' + tiers[i] + ' placeholder exited with code ' + code);
            if (!retry(i + 1)) this.cleanup(session);
            return;
          }

          // Placeholders that can time out get replaced so the session lasts until it is
          // stopped. A windowed one is different: it only ends when someone closes its window,
          // and reopening it against the user's wish would be wrong.
          if (plan.restartOnExit && session.restarts < MAX_RESTARTS) {
            session.restarts += 1;
            console.log('[spoof] ' + label + ' placeholder ended after ' + Math.round(aliveMs / 1000)
              + 's - restarting (#' + session.restarts + ')');
            if (retry(i)) return;
          } else if (!plan.restartOnExit) {
            console.log('[spoof] ' + label + ': window closed - session ended');
          }

          console.log('[spoof] ' + label + ' stopped running (code=' + code + ' signal=' + signal + ')');
          this.cleanup(session);
        });

        return i;
      }

      throw lastError || new Error('no usable placeholder for ' + exe.name);
    };

    const retry = (fromTier) => {
      if (fromTier >= tiers.length) return false;
      try {
        launch(fromTier);
        return true;
      } catch (err) {
        console.error('[spoof] ' + label + ': ' + err.message);
        return false;
      }
    };

    try {
      launch(0);
    } catch (err) {
      return { ok: false, executable: exe.name, reason: err.message };
    }

    if (session.durationMinutes > 0) {
      session.timer = setTimeout(() => {
        console.log('[spoof] ' + game.name + ' / ' + exe.name + ': ' + session.durationMinutes + ' min reached - stopping');
        this.stop(key);
      }, session.durationMinutes * 60000);
      if (session.timer.unref) session.timer.unref();
    }

    this.running.set(key, session);
    console.log('[spoof] started "' + game.name + '" as ' + exe.name
      + ' (pid ' + session.pid + ', ' + tiers[session.tier] + ' placeholder)');
    return { ok: true, executable: exe.name, session: this.describe(session) };
  }

  cleanup(session) {
    if (session.timer) clearTimeout(session.timer);
    const current = this.running.get(session.key);
    if (current && current.pid === session.pid) this.running.delete(session.key);
  }

  /**
   * Stop one session.
   * @param {string} key session key ("<game id>::<executable>")
   * @param {boolean} sync kill without waiting on the event loop (used while shutting down)
   */
  stop(key, sync) {
    const session = this.running.get(String(key));
    if (!session) return { ok: false, reason: 'not running' };

    session.stopping = true;
    const child = session.child;

    if (process.platform === 'win32') {
      const args = ['/PID', String(session.pid), '/T', '/F'];
      if (sync) {
        spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
      } else {
        execFile('taskkill', args, () => {});
      }
    } else if (sync) {
      try { child.kill('SIGKILL'); } catch (err) { /* already gone */ }
    } else {
      try { child.kill('SIGTERM'); } catch (err) { /* already gone */ }
      const hard = setTimeout(() => {
        try { if (!child.killed) child.kill('SIGKILL'); } catch (err) { /* already gone */ }
      }, 3000);
      if (hard.unref) hard.unref();
    }

    this.cleanup(session);
    console.log('[spoof] stopped "' + session.name + '" / ' + session.executable + ' (pid ' + session.pid + ')');
    return { ok: true };
  }

  /** Stop every executable currently running for one game. */
  stopGame(gameId, sync) {
    const keys = this.sessionsOf(gameId).map((s) => s.key);
    keys.forEach((key) => this.stop(key, sync));
    return { ok: keys.length > 0, stopped: keys.length, reason: keys.length ? undefined : 'not running' };
  }

  stopAll(sync) {
    const keys = Array.from(this.running.keys());
    keys.forEach((key) => this.stop(key, sync));
    return keys.length;
  }

  sessionsOf(gameId) {
    return Array.from(this.running.values()).filter((s) => s.gameId === String(gameId));
  }

  describe(session) {
    return {
      key: session.key,
      id: session.gameId,
      gameId: session.gameId,
      name: session.name,
      icon: session.icon,
      executable: session.executable,
      path: session.path,
      pid: session.pid,
      startedAt: session.startedAt,
      elapsedSeconds: Math.floor((Date.now() - session.startedAt) / 1000),
      durationMinutes: session.durationMinutes,
      restarts: session.restarts,
      placeholder: Spoofer.tiers()[session.tier] || null
    };
  }

  list() {
    return Array.from(this.running.values()).map((s) => this.describe(s));
  }
}

module.exports = { Spoofer };
