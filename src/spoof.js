'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
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

// Bumped whenever the C# source below changes, so every cached placeholder is rebuilt once.
const PLACEHOLDER_BUILD = 2;

// Game icons come from Discord's and Steam's CDN. Anything much larger than this is not one.
const MAX_ICON_BYTES = 4 * 1024 * 1024;

/**
 * Download `url` to `target`, following redirects.
 * The bytes land under a temporary name and are renamed into place, because the placeholder
 * window polls for this file and must never read a half-written one.
 */
function downloadFile(url, target, redirects) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (discord-quest-faker)' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((redirects || 0) >= 4) return reject(new Error('too many redirects'));
        return resolve(downloadFile(new URL(res.headers.location, url).toString(), target, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }

      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_ICON_BYTES) {
          request.destroy(new Error('image is larger than ' + MAX_ICON_BYTES + ' bytes'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const temp = target + '.part';
        try {
          fs.writeFileSync(temp, Buffer.concat(chunks));
          fs.renameSync(temp, target);
          resolve(target);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });

    request.setTimeout(8000, () => request.destroy(new Error('timed out')));
    request.on('error', reject);
  });
}

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
    this.iconFetches = new Set(); // icon files being downloaded right now
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
        if (stamp.name === name && stamp.build === PLACEHOLDER_BUILD
          && stamp.size === fs.statSync(target).size) return target;
      } catch (err) { /* rebuild */ }
    }

    const sourcePath = path.join(buildDir, Spoofer.signalToken('s', target) + '.cs');
    const fileName = Spoofer.csharpString(path.basename(target));
    // Stands in for the icon until it is downloaded, and forever if there is none.
    const initial = Spoofer.csharpString(String(displayName || '').trim().charAt(0).toUpperCase() || '?');

    // The window is the point: Discord's detection wants a process that owns a real, visible
    // window with a running message loop, not just a process with a matching executable name.
    //
    // What the window shows beyond that is for the person running it: the game's icon, how
    // long the session has been going, and when it stops by itself. Those are passed as
    // command line arguments rather than compiled in, so one build serves every session.
    fs.writeFileSync(sourcePath, '\ufeff' + [
      'using System;',
      'using System.Drawing;',
      'using System.Globalization;',
      'using System.IO;',
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
      '    private static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);',
      '',
      '    private static Form form;',
      '    private static PictureBox art;',
      '    private static Label initial;',
      '    private static Label elapsed;',
      '    private static Label remaining;',
      '    private static DateTime started = DateTime.UtcNow;',
      '    private static double durationMinutes;',
      '    private static string iconPath;',
      '    private static int ticks;',
      '',
      '    [STAThread]',
      '    private static void Main(string[] argv)',
      '    {',
      '        ReadArguments(argv);',
      '        Application.EnableVisualStyles();',
      '',
      '        form = new Form();',
      '        form.Text = "' + name + '";',
      '        form.ClientSize = new Size(468, 162);',
      '        form.StartPosition = FormStartPosition.CenterScreen;',
      '        form.FormBorderStyle = FormBorderStyle.FixedSingle;',
      '        form.MaximizeBox = false;',
      '        form.BackColor = Color.FromArgb(35, 36, 40);',
      '',
      '        art = new PictureBox();',
      '        art.SetBounds(26, 24, 72, 72);',
      '        art.SizeMode = PictureBoxSizeMode.Zoom;',
      '        art.BackColor = Color.FromArgb(45, 47, 52);',
      '',
      '        initial = new Label();',
      '        initial.Text = "' + initial + '";',
      '        initial.Font = new Font("Segoe UI", 24F, FontStyle.Bold);',
      '        initial.ForeColor = Color.FromArgb(118, 123, 132);',
      '        initial.SetBounds(0, 0, 72, 72);',
      '        initial.TextAlign = ContentAlignment.MiddleCenter;',
      '        art.Controls.Add(initial);',
      '',
      '        Label title = new Label();',
      '        title.Text = "' + name + '";',
      '        title.Font = new Font("Segoe UI", 13F, FontStyle.Bold);',
      '        title.ForeColor = Color.White;',
      '        title.SetBounds(114, 22, 330, 28);',
      '        title.TextAlign = ContentAlignment.MiddleLeft;',
      '        title.AutoEllipsis = true;',
      '',
      '        Label file = new Label();',
      '        file.Text = "' + fileName + '";',
      '        file.Font = new Font("Segoe UI", 9F);',
      '        file.ForeColor = Color.FromArgb(154, 160, 168);',
      '        file.SetBounds(116, 50, 328, 18);',
      '        file.TextAlign = ContentAlignment.MiddleLeft;',
      '        file.AutoEllipsis = true;',
      '',
      '        elapsed = Value(76);',
      '        elapsed.ForeColor = Color.FromArgb(226, 229, 234);',
      '        remaining = Value(98);',
      '',
      '        Label note = new Label();',
      '        note.Text = "Discord Quest Faker placeholder - keep this window open.";',
      '        note.Font = new Font("Segoe UI", 8.5F);',
      '        note.ForeColor = Color.FromArgb(118, 123, 132);',
      '        note.SetBounds(0, 128, 468, 20);',
      '        note.TextAlign = ContentAlignment.MiddleCenter;',
      '',
      '        form.Controls.Add(art);',
      '        form.Controls.Add(title);',
      '        form.Controls.Add(file);',
      '        form.Controls.Add(Caption("Running", 76));',
      '        form.Controls.Add(Caption("Auto-stop", 98));',
      '        form.Controls.Add(elapsed);',
      '        form.Controls.Add(remaining);',
      '        form.Controls.Add(note);',
      '',
      '        Timer timer = new Timer();',
      '        timer.Interval = 1000;',
      '        timer.Tick += Tick;',
      '        timer.Start();',
      '        Tick(null, EventArgs.Empty);',
      '',
      '        Application.Run(form);',
      '    }',
      '',
      '    private static void ReadArguments(string[] argv)',
      '    {',
      '        for (int i = 0; i + 1 < argv.Length; i += 2)',
      '        {',
      '            string value = argv[i + 1];',
      '            if (argv[i] == "--icon")',
      '            {',
      '                iconPath = value == "-" ? null : value;',
      '            }',
      '            else if (argv[i] == "--started")',
      '            {',
      '                double ms;',
      '                if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out ms)) started = Epoch.AddMilliseconds(ms);',
      '            }',
      '            else if (argv[i] == "--duration")',
      '            {',
      '                double minutes;',
      '                if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out minutes)) durationMinutes = minutes;',
      '            }',
      '        }',
      '    }',
      '',
      '    private static Label Caption(string text, int top)',
      '    {',
      '        Label label = new Label();',
      '        label.Text = text;',
      '        label.Font = new Font("Segoe UI", 9F);',
      '        label.ForeColor = Color.FromArgb(132, 137, 145);',
      '        label.SetBounds(116, top, 76, 20);',
      '        label.TextAlign = ContentAlignment.MiddleLeft;',
      '        return label;',
      '    }',
      '',
      '    private static Label Value(int top)',
      '    {',
      '        Label label = new Label();',
      '        label.Font = new Font("Consolas", 10F);',
      '        label.ForeColor = Color.FromArgb(154, 160, 168);',
      '        label.SetBounds(194, top, 250, 20);',
      '        label.TextAlign = ContentAlignment.MiddleLeft;',
      '        return label;',
      '    }',
      '',
      '    private static void Tick(object sender, EventArgs e)',
      '    {',
      '        TimeSpan since = DateTime.UtcNow - started;',
      '        elapsed.Text = Clock(since);',
      '',
      '        if (durationMinutes > 0)',
      '        {',
      '            TimeSpan left = TimeSpan.FromMinutes(durationMinutes) - since;',
      '            remaining.Text = left.Ticks > 0',
      '                ? Clock(left) + " left of " + durationMinutes.ToString("0.##", CultureInfo.InvariantCulture) + " min"',
      '                : "stopping now";',
      '        }',
      '        else',
      '        {',
      '            remaining.Text = "off";',
      '        }',
      '',
      '        LoadIcon();',
      '    }',
      '',
      '    private static string Clock(TimeSpan span)',
      '    {',
      '        if (span.Ticks < 0) span = TimeSpan.Zero;',
      '        return string.Format(CultureInfo.InvariantCulture, "{0:00}:{1:00}:{2:00}", (int)span.TotalHours, span.Minutes, span.Seconds);',
      '    }',
      '',
      '    // The icon is downloaded in the background so a slow CDN never delays the game, which',
      '    // means it can land after this window is already up. Watch for it, then give up.',
      '    private static void LoadIcon()',
      '    {',
      '        ticks++;',
      '        if (iconPath == null || art.Image != null || ticks > 90 || !File.Exists(iconPath)) return;',
      '',
      '        try',
      '        {',
      '            using (FileStream stream = new FileStream(iconPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))',
      '            using (Image image = Image.FromStream(stream))',
      '            {',
      '                art.Image = new Bitmap(image);',
      '                using (Bitmap small = new Bitmap(image, 32, 32)) form.Icon = Icon.FromHandle(small.GetHicon());',
      '            }',
      '            initial.Visible = false;',
      '        }',
      '        catch (Exception)',
      '        {',
      '            // unreadable for now - the next tick tries again',
      '        }',
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

    fs.writeFileSync(stampPath, JSON.stringify({
      name,
      build: PLACEHOLDER_BUILD,
      size: fs.statSync(target).size
    }), 'utf8');
    return target;
  }

  /** Where the game's picture comes from - the same sources the control panel draws. */
  static iconUrl(game) {
    const url = game.iconUrl
      || (game.icon ? 'https://cdn.discordapp.com/app-icons/' + game.id + '/' + game.icon + '.png?size=128' : null);
    return url && /^https:\/\//i.test(url) ? url : null;
  }

  /**
   * Local path of the game's picture, downloading it once if it is not cached yet.
   * The path is returned straight away even while the download runs: the placeholder window
   * polls for the file, so nothing has to wait on the network before the game "starts".
   */
  ensureIcon(game) {
    const url = Spoofer.iconUrl(game);
    if (!url) return null;

    const dir = path.join(this.config.runtimePath, '_icons');
    const target = path.join(dir, Spoofer.safeName(game.id) + '.img');

    try {
      if (fs.statSync(target).size > 0) return target;
    } catch (err) { /* not downloaded yet */ }

    if (!this.iconFetches.has(target)) {
      this.iconFetches.add(target);
      try {
        fs.mkdirSync(dir, { recursive: true });
        downloadFile(url, target)
          .catch((err) => console.warn('[spoof] no picture for "' + game.name + '" (' + err.message + ')'))
          .then(() => this.iconFetches.delete(target));
      } catch (err) {
        this.iconFetches.delete(target);
        return null;
      }
    }
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

  /**
   * A game id ("steam:3787240") or executable name is arbitrary third-party text, so keep it
   * away from the file system's sharp edges before it becomes part of a path.
   */
  static safeName(value) {
    return String(value).replace(/[^0-9a-zA-Z._-]/g, '_');
  }

  /** One session per executable, so the same game can run several of them at once. */
  static sessionKey(gameId, executableName) {
    return String(gameId) + '::' + executableName;
  }

  /**
   * Executables for this platform, de-duplicated, launchers last.
   * Entries for other platforms are never offered: a process named foo.exe on macOS cannot
   * happen with a real game, which makes it an obvious spoofing signal.
   */
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
    const gameDirName = Spoofer.safeName(game.id);
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
  provision(target, tier, game, exe, session) {
    if (tier === 'compiled') {
      this.compile(target, game.name);
      // What the window shows about this particular run travels as arguments, so the compiled
      // file stays the same across sessions and does not have to be rebuilt for each one.
      return {
        args: [
          '--icon', this.ensureIcon(game) || '-',
          '--started', String(session.startedAt),
          '--duration', String(session.durationMinutes)
        ],
        // A windowed app only quits when its window is closed, so that counts as a stop.
        hasWindow: true,
        hideWindow: false,
        restartOnExit: false
      };
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
          plan = this.provision(fakePath, tiers[i], game, exe, session);
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

        // No pid means the spawn failed outright (missing binary, blocked by policy, a file
        // an antivirus just removed). The 'error' event only arrives on a later tick, so catch
        // the failure here and fall through to the next tier instead of reporting success.
        if (!child.pid) {
          // The failure still arrives as an async 'error' event; without a listener Node
          // rethrows it and takes the whole program down.
          child.on('error', () => {});
          lastError = new Error(tiers[i] + ' placeholder could not be spawned');
          console.error('[spoof] ' + label + ': ' + lastError.message);
          continue;
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
