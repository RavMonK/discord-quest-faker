'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
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

// How many times a tier may be killed before the next tier is tried instead. Restarting twice
// covers a one-off death; a third means the tier itself does not work on this machine.
const MAX_TIER_DEATHS = 3;

// Bumped whenever the C#, Objective-C or C source below changes, so every cached placeholder
// is rebuilt once.
const PLACEHOLDER_BUILD = 4;

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
    this.warned = new Set(); // platform caveats already printed this run
    this.endListeners = []; // notified once per session that leaves `running`
    // Disk stamps are writable alongside executables. Trust only builds made this process.
    this.compiledCache = new Map();
    this.keepalivePath = path.join(config.runtimePath, 'keepalive.js');
    fs.mkdirSync(config.runtimePath, { recursive: true, mode: 0o700 });
    this.runtimeTarget('keepalive.js');
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
    if (process.platform === 'win32') return ['compiled', 'system', 'node'];
    // macOS has its own compiled tier (clang + Cocoa) and deliberately has no `system` one:
    // /bin/sleep carries a launch constraint tying it to /bin, so the code signing monitor
    // SIGKILLs any copy of it anywhere between a few seconds and a couple of minutes in
    // ("Launch Constraint Violation"). The Node copy has no such constraint and survives, but
    // it owns no window - so it is the fallback, not the first choice.
    if (process.platform === 'darwin') return ['compiled', 'node'];
    // Linux has both: a compiled X11 window (any C compiler, no development packages) and a
    // copied /bin/sleep for machines with no compiler or no display to put a window on.
    if (process.platform === 'linux') return ['compiled', 'system', 'node'];
    return ['system', 'node'];
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
   * The macOS equivalent of `cscPath()`: clang plus an SDK holding Cocoa. Both come with the
   * Xcode Command Line Tools, which most machines with a compiler already have - and which
   * `xcode-select --install` puts there on the ones that do not.
   */
  static clangPath() {
    const clang = spawnSync('xcrun', ['--find', 'clang'], { encoding: 'utf8' });
    const sdk = spawnSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' });
    if (clang.status !== 0 || sdk.status !== 0) return null;

    const binary = String(clang.stdout || '').trim();
    const root = String(sdk.stdout || '').trim();
    if (!binary || !root || !fs.existsSync(binary)) return null;
    // Without Cocoa there is no window to build, which is the whole point of this tier.
    if (!fs.existsSync(path.join(root, 'System', 'Library', 'Frameworks', 'Cocoa.framework'))) return null;
    return { binary, sdk: root };
  }

  /**
   * The Linux equivalent: any C compiler at all. Nothing else is needed - the placeholder
   * reaches Xlib through dlopen, so there are no X11 headers to install and no -lX11 to link,
   * which is what keeps this tier available on a plain desktop rather than a build machine.
   */
  static linuxCompiler() {
    const names = [process.env.CC, 'cc', 'gcc', 'clang'].filter(Boolean);
    const dirs = String(process.env.PATH || '/usr/bin:/bin').split(path.delimiter).filter(Boolean);
    for (const name of names) {
      const found = path.isAbsolute(name)
        ? [name]
        : dirs.map((dir) => path.join(dir, name));
      for (const candidate of found) {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch (err) { /* not here, try the next one */ }
      }
    }
    return null;
  }

  /**
   * C string literal contents - the game name is arbitrary text from an API. Serves the
   * Objective-C and the C source alike; they escape string literals the same way.
   */
  static cString(text) {
    return String(text || 'Game')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  /**
   * The game's name with the accents folded away and anything still outside ASCII dropped.
   *
   * The Linux window draws with a core X font, which is single byte: a name like
   * "MARVEL Tokon" written with its real diacritic comes out as mojibake. The window's title
   * goes through _NET_WM_NAME and keeps the real name; only what the program paints is folded.
   */
  static asciiLabel(text, fallback) {
    const folded = String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return folded || String(fallback || 'Game');
  }

  /**
   * Fallbacks for machines without a compiler. These keep a process with the right name alive
   * but own no window, so Discord may not pick them up - a compiled tier is the one that works.
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

  /** Build a windowed placeholder at `target` with whichever compiler this platform ships. */
  compile(target, game) {
    if (process.platform === 'darwin') return this.compileMac(target, game);
    if (process.platform === 'linux') return this.compileLinux(target, game);
    return this.compileWindows(target, game.name);
  }

  /**
   * The macOS twin of `compileWindows()`: a real Cocoa app, compiled straight to its final path
   * inside the .app bundle.
   *
   * Everything Discord's macOS module can look at is satisfied by this and by nothing else we
   * can build: `proc_pidpath()` reports the game's own path, NSPrincipalClass plus a Regular
   * activation policy make the process a registered application in NSWorkspace, and the window
   * shows up in `CGWindowListCopyWindowInfo` on screen at layer 0. The Node placeholder gets the
   * first of those three and neither of the others.
   */
  compileMac(target, game) {
    const clang = Spoofer.clangPath();
    if (!clang) throw new Error('clang with the Cocoa SDK not found (xcode-select --install)');

    const buildDir = this.runtimeTarget('_build');
    fs.mkdirSync(buildDir, { recursive: true });

    const name = Spoofer.cString(game.name);
    if (this.compiledMatches(target, name)) return target;

    // Stands in for the icon until it is downloaded, and forever if there is none.
    const initial = Spoofer.cString(String(game.name || '').trim().charAt(0).toUpperCase() || '?');
    const sourcePath = this.runtimeTarget('_build', Spoofer.signalToken('o', target) + '.m');
    fs.writeFileSync(sourcePath, Spoofer.macSource(name, initial), 'utf8');

    // Compiling into the bundle directly would fail once macOS has protected it, so the binary
    // is built aside and installed in a step that knows how to recover from that.
    const built = this.runtimeTarget('_build', Spoofer.signalToken('x', target) + '.bin');
    const result = spawnSync(clang.binary, [
      '-x', 'objective-c', '-fobjc-arc', '-O2', '-isysroot', clang.sdk,
      '-framework', 'Cocoa', '-o', built, sourcePath
    ], { timeout: 60000, encoding: 'utf8' });

    if (result.status !== 0 || !fs.existsSync(built)) {
      throw new Error('clang failed: '
        + String(result.stderr || result.stdout || result.error || '').trim().split('\n')[0]);
    }

    this.installMacBinary(built, target, game);
    this.rememberCompiled(target, name);
    return target;
  }

  /**
   * Move a freshly built binary into its place inside the bundle.
   *
   * Creating a file inside a bundle macOS has already launched is refused (App Management
   * protection, EPERM) even after unlinking the old one - but deleting the whole bundle is
   * still allowed, so that is the way back in.
   */
  installMacBinary(built, target, game) {
    const place = () => {
      try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (err) { /* in use */ }
      fs.copyFileSync(built, target);
      fs.chmodSync(target, 0o755);
    };

    try {
      place();
      return target;
    } catch (err) {
      // EPERM is App Management protection; EACCES is a directory we plainly cannot write to.
      if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
    }

    Spoofer.rebuildBundle(target, game.id);
    place();
    return target;
  }

  /**
   * Drop the .app bundle around `target` and build an empty one back, returning its
   * Contents/MacOS directory. This is the only way into a bundle macOS has protected: writing
   * inside it is refused, deleting it is not.
   */
  static rebuildBundle(target, gameId) {
    // <bundle>/Contents/MacOS/<binary> - anything else means there is no bundle here to rebuild.
    const macosDir = path.dirname(target);
    const bundleDir = path.dirname(path.dirname(macosDir));
    if (path.basename(macosDir) !== 'MacOS' || !bundleDir.toLowerCase().endsWith('.app')) {
      throw new Error('could not write ' + path.basename(target) + ' into its bundle, and '
        + bundleDir + ' is not one that can be rebuilt');
    }

    fs.rmSync(bundleDir, { recursive: true, force: true });
    fs.mkdirSync(macosDir, { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'Contents', 'Info.plist'),
      Spoofer.bundlePlist(path.basename(target), gameId), 'utf8');
    return macosDir;
  }

  /**
   * The Objective-C the macOS placeholder is built from.
   *
   * The window is the point: on Windows Discord wants a process that owns a real visible window,
   * and macOS is the same shape of problem - a bare process is only a path, while this one is a
   * registered application that owns an on-screen window.
   *
   * What the window shows beyond that is for the person running it: the game's icon, how long
   * the session has been going, and when it stops by itself. Those arrive as command line
   * arguments rather than compiled in, so one build serves every session.
   */
  static macSource(name, initial) {
    return [
      '#import <Cocoa/Cocoa.h>',
      '#import <math.h>',
      '',
      'static NSString *const kName = @"' + name + '";',
      'static NSString *const kInitial = @"' + initial + '";',
      '',
      'static NSString *ArgValue(NSString *flag) {',
      '    NSArray<NSString *> *args = [[NSProcessInfo processInfo] arguments];',
      '    for (NSUInteger i = 1; i + 1 < args.count; i++) {',
      '        if ([args[i] isEqualToString:flag]) return args[i + 1];',
      '    }',
      '    return nil;',
      '}',
      '',
      'static NSString *Clock(double seconds) {',
      '    if (isnan(seconds) || seconds < 0) seconds = 0;',
      '    long total = (long)floor(seconds);',
      '    return [NSString stringWithFormat:@"%02ld:%02ld:%02ld", total / 3600, (total / 60) % 60, total % 60];',
      '}',
      '',
      '@interface Placeholder : NSObject <NSApplicationDelegate>',
      '@end',
      '',
      '@implementation Placeholder {',
      '    NSWindow *_window;',
      '    NSTextField *_elapsed;',
      '    NSTextField *_stops;',
      '    NSTextField *_initial;',
      '    NSImageView *_art;',
      '    NSString *_iconPath;',
      '    double _startedAt;',
      '    double _durationMinutes;',
      '    BOOL _artLoaded;',
      '}',
      '',
      '- (NSTextField *)labelWith:(NSString *)text size:(CGFloat)size bold:(BOOL)bold dim:(BOOL)dim {',
      '    NSTextField *field = [NSTextField labelWithString:text];',
      '    field.font = bold ? [NSFont boldSystemFontOfSize:size] : [NSFont systemFontOfSize:size];',
      '    if (dim) field.textColor = [NSColor secondaryLabelColor];',
      '    return field;',
      '}',
      '',
      '- (void)applicationDidFinishLaunching:(NSNotification *)note {',
      '    _startedAt = [ArgValue(@"--started") doubleValue] / 1000.0;',
      '    if (_startedAt <= 0) _startedAt = [[NSDate date] timeIntervalSince1970];',
      '    _durationMinutes = [ArgValue(@"--duration") doubleValue];',
      '    NSString *icon = ArgValue(@"--icon");',
      '    _iconPath = (icon.length && ![icon isEqualToString:@"-"]) ? icon : nil;',
      '',
      '    _window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 430, 172)',
      '        styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable)',
      '          backing:NSBackingStoreBuffered defer:NO];',
      '    _window.title = kName;',
      '    _window.releasedWhenClosed = NO;',
      '',
      '    _art = [[NSImageView alloc] init];',
      '    _art.imageScaling = NSImageScaleProportionallyUpOrDown;',
      '    _art.hidden = YES;',
      '',
      '    _initial = [self labelWith:kInitial size:40 bold:YES dim:NO];',
      '    _initial.textColor = [NSColor tertiaryLabelColor];',
      '    _initial.alignment = NSTextAlignmentCenter;',
      '',
      '    NSView *badge = [[NSView alloc] init];',
      '    for (NSView *child in @[_initial, _art]) {',
      '        child.translatesAutoresizingMaskIntoConstraints = NO;',
      '        [badge addSubview:child];',
      '        [NSLayoutConstraint activateConstraints:@[',
      '            [child.leadingAnchor constraintEqualToAnchor:badge.leadingAnchor],',
      '            [child.trailingAnchor constraintEqualToAnchor:badge.trailingAnchor],',
      '            [child.centerYAnchor constraintEqualToAnchor:badge.centerYAnchor]',
      '        ]];',
      '    }',
      '    [NSLayoutConstraint activateConstraints:@[',
      '        [badge.widthAnchor constraintEqualToConstant:88],',
      '        [badge.heightAnchor constraintEqualToConstant:88],',
      '        [_art.heightAnchor constraintEqualToConstant:88]',
      '    ]];',
      '',
      '    _elapsed = [self labelWith:@"elapsed 00:00:00" size:13 bold:NO dim:NO];',
      '    _stops = [self labelWith:@"" size:11 bold:NO dim:YES];',
      '',
      '    NSStackView *text = [NSStackView stackViewWithViews:@[',
      '        [self labelWith:kName size:17 bold:YES dim:NO], _elapsed, _stops,',
      '        [self labelWith:@"Closing this window ends the session." size:11 bold:NO dim:YES]',
      '    ]];',
      '    text.orientation = NSUserInterfaceLayoutOrientationVertical;',
      '    text.alignment = NSLayoutAttributeLeading;',
      '    text.spacing = 5;',
      '',
      '    NSStackView *row = [NSStackView stackViewWithViews:@[badge, text]];',
      '    row.orientation = NSUserInterfaceLayoutOrientationHorizontal;',
      '    row.alignment = NSLayoutAttributeCenterY;',
      '    row.spacing = 18;',
      '    row.translatesAutoresizingMaskIntoConstraints = NO;',
      '',
      '    [_window.contentView addSubview:row];',
      '    [NSLayoutConstraint activateConstraints:@[',
      '        [row.leadingAnchor constraintEqualToAnchor:_window.contentView.leadingAnchor constant:22],',
      '        [row.trailingAnchor constraintLessThanOrEqualToAnchor:_window.contentView.trailingAnchor constant:-22],',
      '        [row.centerYAnchor constraintEqualToAnchor:_window.contentView.centerYAnchor]',
      '    ]];',
      '',
      '    [_window center];',
      '    [_window makeKeyAndOrderFront:nil];',
      '',
      '    [NSTimer scheduledTimerWithTimeInterval:1.0 repeats:YES block:^(NSTimer *timer) { [self tick]; }];',
      '    [self tick];',
      '}',
      '',
      '- (void)tick {',
      '    double elapsed = [[NSDate date] timeIntervalSince1970] - _startedAt;',
      '    _elapsed.stringValue = [NSString stringWithFormat:@"elapsed %@", Clock(elapsed)];',
      '    _stops.stringValue = _durationMinutes > 0',
      '        ? [NSString stringWithFormat:@"stops by itself in %@", Clock(_durationMinutes * 60.0 - elapsed)]',
      '        : @"runs until you stop it";',
      '',
      '    // The icon is downloaded while the session is already running, so keep looking for it.',
      '    if (!_artLoaded && _iconPath && [[NSFileManager defaultManager] fileExistsAtPath:_iconPath]) {',
      '        NSImage *image = [[NSImage alloc] initWithContentsOfFile:_iconPath];',
      '        if (image) {',
      '            _art.image = image;',
      '            _art.hidden = NO;',
      '            _initial.hidden = YES;',
      '            NSApp.applicationIconImage = image;',
      '            _artLoaded = YES;',
      '        }',
      '    }',
      '}',
      '',
      '- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app { return YES; }',
      '',
      '@end',
      '',
      '// NSApplication only holds its delegate weakly, so the strong reference lives here.',
      'static Placeholder *gDelegate = nil;',
      '',
      'int main(int argc, const char *argv[]) {',
      '    @autoreleasepool {',
      '        NSApplication *app = [NSApplication sharedApplication];',
      '        // Regular is what lists the process in NSWorkspace runningApplications, beside real apps.',
      '        [app setActivationPolicy:NSApplicationActivationPolicyRegular];',
      '        gDelegate = [[Placeholder alloc] init];',
      '        app.delegate = gDelegate;',
      '        [app run];',
      '    }',
      '    return 0;',
      '}',
      ''
    ].join('\n');
  }

  /**
   * Compile the placeholder straight to its final path, so the version info Windows reads
   * (OriginalFilename) is the game's executable name rather than a borrowed one.
   */
  compileWindows(target, displayName) {
    const csc = Spoofer.cscPath();
    if (!csc) throw new Error('csc.exe (.NET Framework) not found');

    const buildDir = this.runtimeTarget('_build');
    fs.mkdirSync(buildDir, { recursive: true });

    const name = Spoofer.csharpString(displayName);
    if (this.compiledMatches(target, name)) return target;

    const sourcePath = this.runtimeTarget('_build', Spoofer.signalToken('s', target) + '.cs');
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

    this.rememberCompiled(target, name);
    return target;
  }

  /**
   * The Linux twin of the other two: a real X11 window, compiled straight to its final path.
   *
   * There is no toolkit to depend on here. The source below opens libX11 with dlopen and looks
   * every entry point up by name, so the only thing this tier needs is a C compiler - no X11
   * headers, no development package, nothing to link. What it cannot do is draw the game's
   * picture: decoding a PNG needs a library, so the window shows the game's initial instead.
   */
  compileLinux(target, game) {
    // A window needs a display to appear on. A headless machine, or a Wayland session without
    // XWayland, has none - those belong on a windowless tier rather than on a build that fails
    // every time it is launched.
    if (!process.env.DISPLAY) throw new Error('no X display (DISPLAY is not set)');
    const cc = Spoofer.linuxCompiler();
    if (!cc) throw new Error('no C compiler found (install cc, gcc or clang)');

    const fileName = path.basename(target);
    const label = Spoofer.asciiLabel(game.name, fileName);
    const name = Spoofer.cString(game.name);
    if (this.compiledMatches(target, name)) return target;

    fs.mkdirSync(this.runtimeTarget('_build'), { recursive: true });
    const sourcePath = this.runtimeTarget('_build', Spoofer.signalToken('c', target) + '.c');
    // Stands in for the icon this window cannot decode.
    const initial = Spoofer.cString(label.charAt(0).toUpperCase() || '?');
    fs.writeFileSync(sourcePath, Spoofer.linuxSource(name, Spoofer.cString(label),
      Spoofer.cString(fileName), initial), 'utf8');

    // Writing over the file while it runs fails with ETXTBSY; unlinking it first does not, and
    // the process still running keeps the inode it was started from.
    try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (err) { /* cc will tell us */ }

    const build = (args) => spawnSync(cc, args, { timeout: 60000, encoding: 'utf8' });
    // dlopen lives in libdl on older glibc and in libc itself since 2.34, where some
    // toolchains reject the flag outright - so a refused -ldl is not a failed build.
    let result = build(['-O2', '-o', target, sourcePath, '-ldl']);
    if (result.status !== 0) result = build(['-O2', '-o', target, sourcePath]);

    if (result.status !== 0 || !fs.existsSync(target)) {
      throw new Error('cc failed: '
        + String(result.stderr || result.stdout || result.error || '').trim().split('\n')[0]);
    }

    fs.chmodSync(target, 0o755);
    this.rememberCompiled(target, name);
    return target;
  }

  /**
   * The C the Linux placeholder is built from.
   *
   * Same purpose as the window on the other two platforms: a process that owns a real, mapped,
   * named window rather than a bare entry in the process table. It reports the game's name and
   * executable, how long the session has been going and when it stops by itself, and closing
   * it ends the session. Those values arrive as command line arguments, so one build serves
   * every session of the same game.
   */
  static linuxSource(name, label, fileName, initial) {
    return [
      '#include <dlfcn.h>',
      '#include <poll.h>',
      '#include <stdio.h>',
      '#include <stdlib.h>',
      '#include <string.h>',
      '#include <time.h>',
      '#include <unistd.h>',
      '',
      'static const char *kName = "' + name + '";',
      '/* Core X fonts are single byte, so the drawn name is the ASCII-folded one. */',
      'static const char *kLabel = "' + label + '";',
      'static const char *kFile = "' + fileName + '";',
      'static const char *kInitial = "' + initial + '";',
      '',
      '/*',
      ' * Xlib is opened with dlopen and every entry point is looked up by name, so this builds with',
      ' * nothing but a C compiler: no X11 headers, no -lX11, no development package. libX11.so.6 is',
      ' * on every machine that runs an X or XWayland session, which is exactly where a window can',
      ' * appear at all. Only the handful of types below are needed, and they are part of the stable',
      ' * X11 ABI.',
      ' */',
      'typedef struct XDisplayOpaque Display;',
      'typedef unsigned long XID;',
      'typedef XID Window;',
      'typedef XID Font;',
      'typedef XID Atom;',
      'typedef XID Colormap;',
      'typedef void *GC;',
      '',
      'typedef struct { unsigned long pixel; unsigned short red, green, blue; char flags, pad; } XColor;',
      'typedef struct { char *res_name; char *res_class; } XClassHint;',
      'typedef struct {',
      '    long flags; int x, y, width, height;',
      '    int min_width, min_height, max_width, max_height;',
      '    int width_inc, height_inc;',
      '    struct { int x, y; } min_aspect, max_aspect;',
      '    int base_width, base_height, win_gravity;',
      '} XSizeHints;',
      'typedef struct {',
      '    int type; unsigned long serial; int send_event; Display *display;',
      '    Window window; Atom message_type; int format; long data[5];',
      '} XClientMessage;',
      '/* Big enough for any event the server can send us, whichever kind it turns out to be. */',
      'typedef union { long pad[32]; int type; XClientMessage client; } XEventBuffer;',
      '',
      '#define ExposureMask (1L << 15)',
      '#define StructureNotifyMask (1L << 17)',
      '#define Expose 12',
      '#define DestroyNotify 17',
      '#define ClientMessage 33',
      '#define XA_CARDINAL 6',
      '#define PropModeReplace 0',
      '#define PMinSize (1L << 4)',
      '#define PMaxSize (1L << 5)',
      '#define DoRGB 7',
      '',
      'static Display *(*XOpenDisplay)(const char *);',
      'static int (*XDefaultScreen)(Display *);',
      'static Window (*XRootWindow)(Display *, int);',
      'static Colormap (*XDefaultColormap)(Display *, int);',
      'static int (*XAllocColor)(Display *, Colormap, XColor *);',
      'static unsigned long (*XWhitePixel)(Display *, int);',
      'static unsigned long (*XBlackPixel)(Display *, int);',
      'static Window (*XCreateSimpleWindow)(Display *, Window, int, int, unsigned int, unsigned int,',
      '                                     unsigned int, unsigned long, unsigned long);',
      'static int (*XStoreName)(Display *, Window, const char *);',
      'static int (*XSetIconName)(Display *, Window, const char *);',
      'static int (*XSetClassHint)(Display *, Window, XClassHint *);',
      'static int (*XSetWMNormalHints)(Display *, Window, XSizeHints *);',
      'static int (*XSetWMProtocols)(Display *, Window, Atom *, int);',
      'static Atom (*XInternAtom)(Display *, const char *, int);',
      'static int (*XChangeProperty)(Display *, Window, Atom, Atom, int, int, const unsigned char *, int);',
      'static int (*XSelectInput)(Display *, Window, long);',
      'static int (*XMapWindow)(Display *, Window);',
      'static int (*XFlush)(Display *);',
      'static int (*XPending)(Display *);',
      'static int (*XNextEvent)(Display *, XEventBuffer *);',
      'static int (*XConnectionNumber)(Display *);',
      'static GC (*XCreateGC)(Display *, Window, unsigned long, void *);',
      'static int (*XSetForeground)(Display *, GC, unsigned long);',
      'static int (*XSetFont)(Display *, GC, Font);',
      'static int (*XDrawString)(Display *, Window, GC, int, int, const char *, int);',
      'static int (*XFillRectangle)(Display *, Window, GC, int, int, unsigned int, unsigned int);',
      'static char **(*XListFonts)(Display *, const char *, int, int *);',
      'static void (*XFreeFontNames)(char **);',
      'static Font (*XLoadFont)(Display *, const char *);',
      'static void *(*XSetErrorHandler)(void *);',
      '',
      'static Display *dpy;',
      'static Window win;',
      'static Atom closeMessage;',
      'static GC gcTitle, gcText, gcDim, gcValue, gcBadge, gcInitial, gcBack;',
      'static double startedAt, durationMinutes;',
      '',
      '/* Xlib\'s default error handler exits the process; a stray BadFont must not end the session. */',
      'static int quiet(Display *display, void *error) { (void)display; (void)error; return 0; }',
      '',
      'static unsigned long colour(int screen, int r, int g, int b, unsigned long fallback) {',
      '    XColor wanted;',
      '    memset(&wanted, 0, sizeof wanted);',
      '    wanted.red = (unsigned short)(r * 257);',
      '    wanted.green = (unsigned short)(g * 257);',
      '    wanted.blue = (unsigned short)(b * 257);',
      '    wanted.flags = DoRGB;',
      '    if (!XAllocColor(dpy, XDefaultColormap(dpy, screen), &wanted)) return fallback;',
      '    return wanted.pixel;',
      '}',
      '',
      '/*',
      ' * First font matching any of these patterns, or 0 to keep whatever font the GC was created',
      ' * with. Nothing here is guaranteed to exist - X has no standard font set - so the patterns run',
      ' * from the nicest to the ones a bare X server still ships, and asking the server which of them',
      ' * it has (XListFonts) is what keeps XLoadFont from failing.',
      ' */',
      'static Font font(const char **patterns, int count) {',
      '    for (int i = 0; i < count; i++) {',
      '        int found = 0;',
      '        char **names = XListFonts(dpy, patterns[i], 1, &found);',
      '        if (!names) continue;',
      '        Font id = found > 0 ? XLoadFont(dpy, names[0]) : 0;',
      '        XFreeFontNames(names);',
      '        if (id) return id;',
      '    }',
      '    return 0;',
      '}',
      '',
      'static GC pen(unsigned long ink, Font face) {',
      '    GC gc = XCreateGC(dpy, win, 0, NULL);',
      '    XSetForeground(dpy, gc, ink);',
      '    if (face) XSetFont(dpy, gc, face);',
      '    return gc;',
      '}',
      '',
      'static const char *argValue(int argc, char **argv, const char *flag) {',
      '    for (int i = 1; i + 1 < argc; i++) {',
      '        if (strcmp(argv[i], flag) == 0) return argv[i + 1];',
      '    }',
      '    return NULL;',
      '}',
      '',
      'static double now(void) {',
      '    struct timespec tick;',
      '    clock_gettime(CLOCK_REALTIME, &tick);',
      '    return (double)tick.tv_sec + tick.tv_nsec / 1e9;',
      '}',
      '',
      'static void clockText(double seconds, char *out, size_t size) {',
      '    if (seconds < 0 || seconds != seconds) seconds = 0;',
      '    long total = (long)seconds;',
      '    snprintf(out, size, "%02ld:%02ld:%02ld", total / 3600, (total / 60) % 60, total % 60);',
      '}',
      '',
      'static void draw(const char *text, GC gc, int x, int y) {',
      '    XDrawString(dpy, win, gc, x, y, text, (int)strlen(text));',
      '}',
      '',
      '/* The two lines that change every second, painted over their own background. */',
      'static void drawValues(void) {',
      '    char text[64];',
      '    double elapsed = now() - startedAt;',
      '',
      '    XFillRectangle(dpy, win, gcBack, 196, 84, 268, 40);',
      '    clockText(elapsed, text, sizeof text);',
      '    draw(text, gcValue, 196, 98);',
      '',
      '    if (durationMinutes > 0) {',
      '        double left = durationMinutes * 60.0 - elapsed;',
      '        char span[32];',
      '        clockText(left, span, sizeof span);',
      '        if (left > 0) snprintf(text, sizeof text, "%s left of %g min", span, durationMinutes);',
      '        else snprintf(text, sizeof text, "stopping now");',
      '    } else {',
      '        snprintf(text, sizeof text, "off");',
      '    }',
      '    draw(text, gcValue, 196, 118);',
      '}',
      '',
      'static void drawAll(void) {',
      '    XFillRectangle(dpy, win, gcBadge, 22, 26, 76, 76);',
      '    draw(kInitial, gcInitial, 50, 76);',
      '    draw(kLabel, gcTitle, 116, 48);',
      '    draw(kFile, gcDim, 116, 70);',
      '    draw("Running", gcText, 116, 98);',
      '    draw("Auto-stop", gcText, 116, 118);',
      '    draw("Discord Quest Faker placeholder - keep this window open.", gcDim, 22, 146);',
      '    drawValues();',
      '}',
      '',
      'static void *lib;',
      '',
      'static int missing(const char *symbol) {',
      '    fprintf(stderr, "libX11 has no %s\\n", symbol);',
      '    return 3;',
      '}',
      '',
      '#define BIND(fn) do { *(void **)(&fn) = dlsym(lib, #fn); if (!fn) return missing(#fn); } while (0)',
      '',
      'static int connect(void) {',
      '    lib = dlopen("libX11.so.6", RTLD_LAZY);',
      '    if (!lib) lib = dlopen("libX11.so", RTLD_LAZY);',
      '    if (!lib) {',
      '        fprintf(stderr, "libX11 not found\\n");',
      '        return 3;',
      '    }',
      '',
      '    BIND(XOpenDisplay); BIND(XDefaultScreen); BIND(XRootWindow); BIND(XDefaultColormap);',
      '    BIND(XAllocColor); BIND(XWhitePixel); BIND(XBlackPixel); BIND(XCreateSimpleWindow);',
      '    BIND(XStoreName); BIND(XSetIconName); BIND(XSetClassHint); BIND(XSetWMNormalHints);',
      '    BIND(XSetWMProtocols); BIND(XInternAtom); BIND(XChangeProperty); BIND(XSelectInput);',
      '    BIND(XMapWindow); BIND(XFlush); BIND(XPending); BIND(XNextEvent); BIND(XConnectionNumber);',
      '    BIND(XCreateGC); BIND(XSetForeground); BIND(XSetFont); BIND(XDrawString);',
      '    BIND(XFillRectangle); BIND(XListFonts); BIND(XFreeFontNames); BIND(XLoadFont);',
      '    BIND(XSetErrorHandler);',
      '    return 0;',
      '}',
      '',
      'static void build(void) {',
      '    static const char *titleFonts[] = { "-*-dejavu sans-bold-r-*--17-*", "-*-helvetica-bold-r-*--17-*",',
      '                                        "10x20", "9x15bold", "-misc-fixed-bold-r-normal--15-*" };',
      '    static const char *badgeFonts[] = { "-*-dejavu sans-bold-r-*--34-*", "-*-helvetica-bold-r-*--34-*",',
      '                                        "12x24", "10x20" };',
      '    static const char *valueFonts[] = { "9x15", "-misc-fixed-medium-r-normal--13-*", "fixed" };',
      '',
      '    int screen = XDefaultScreen(dpy);',
      '    unsigned long white = XWhitePixel(dpy, screen), black = XBlackPixel(dpy, screen);',
      '    unsigned long back = colour(screen, 35, 36, 40, black);',
      '    win = XCreateSimpleWindow(dpy, XRootWindow(dpy, screen), 0, 0, 480, 160, 0, back, back);',
      '',
      '    Font title = font(titleFonts, 5), badge = font(badgeFonts, 4), value = font(valueFonts, 3);',
      '    gcTitle = pen(colour(screen, 255, 255, 255, white), title);',
      '    gcText = pen(colour(screen, 226, 229, 234, white), 0);',
      '    gcDim = pen(colour(screen, 132, 137, 145, white), 0);',
      '    gcValue = pen(colour(screen, 154, 160, 168, white), value);',
      '    gcBadge = pen(colour(screen, 45, 47, 52, black), 0);',
      '    gcInitial = pen(colour(screen, 118, 123, 132, white), badge);',
      '    gcBack = pen(back, 0);',
      '',
      '    /* Named and classed like an application window, because that is what this pretends to be. */',
      '    XClassHint identity;',
      '    identity.res_name = (char *)kFile;',
      '    identity.res_class = (char *)kLabel;',
      '    XStoreName(dpy, win, kName);',
      '    XSetIconName(dpy, win, kName);',
      '    XSetClassHint(dpy, win, &identity);',
      '    /* WM_NAME above is Latin-1 by protocol; this is the title a modern window manager reads. */',
      '    XChangeProperty(dpy, win, XInternAtom(dpy, "_NET_WM_NAME", 0),',
      '                    XInternAtom(dpy, "UTF8_STRING", 0), 8, PropModeReplace,',
      '                    (const unsigned char *)kName, (int)strlen(kName));',
      '',
      '    long pid = (long)getpid();',
      '    XChangeProperty(dpy, win, XInternAtom(dpy, "_NET_WM_PID", 0), XA_CARDINAL, 32,',
      '                    PropModeReplace, (const unsigned char *)&pid, 1);',
      '',
      '    /* Everything is drawn at fixed coordinates, so let no window manager resize it. */',
      '    XSizeHints size;',
      '    memset(&size, 0, sizeof size);',
      '    size.flags = PMinSize | PMaxSize;',
      '    size.min_width = size.max_width = 480;',
      '    size.min_height = size.max_height = 160;',
      '    XSetWMNormalHints(dpy, win, &size);',
      '',
      '    /* Without this the window manager\'s close button kills the client instead of asking it. */',
      '    closeMessage = XInternAtom(dpy, "WM_DELETE_WINDOW", 0);',
      '    XSetWMProtocols(dpy, win, &closeMessage, 1);',
      '',
      '    XSelectInput(dpy, win, ExposureMask | StructureNotifyMask);',
      '    XMapWindow(dpy, win);',
      '}',
      '',
      'int main(int argc, char **argv) {',
      '    const char *started = argValue(argc, argv, "--started");',
      '    const char *duration = argValue(argc, argv, "--duration");',
      '    int failure = connect();',
      '    if (failure) return failure;',
      '',
      '    startedAt = started ? atof(started) / 1000.0 : 0;',
      '    if (startedAt <= 0) startedAt = now();',
      '    durationMinutes = duration ? atof(duration) : 0;',
      '',
      '    XSetErrorHandler((void *)quiet);',
      '    dpy = XOpenDisplay(NULL);',
      '    if (!dpy) {',
      '        fprintf(stderr, "no X display to open\\n");',
      '        return 3;',
      '    }',
      '',
      '    build();',
      '    drawAll();',
      '    XFlush(dpy);',
      '',
      '    /* Wake for an event, and once a second regardless so the clock keeps moving. */',
      '    int fd = XConnectionNumber(dpy);',
      '    for (;;) {',
      '        struct pollfd waiting;',
      '        waiting.fd = fd;',
      '        waiting.events = POLLIN;',
      '        waiting.revents = 0;',
      '        poll(&waiting, 1, 1000);',
      '',
      '        while (XPending(dpy) > 0) {',
      '            XEventBuffer event;',
      '            memset(&event, 0, sizeof event);',
      '            XNextEvent(dpy, &event);',
      '            /* Closing the window is how someone stops the session from the window itself. */',
      '            if (event.type == DestroyNotify) return 0;',
      '            if (event.type == ClientMessage && (Atom)event.client.data[0] == closeMessage) return 0;',
      '            if (event.type == Expose) drawAll();',
      '        }',
      '        drawValues();',
      '        XFlush(dpy);',
      '    }',
      '}',
      ''
    ].join('\n');
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

  static gameDirectory(value) {
    const id = String(value ?? '');
    if (id.length > 128 || !/^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*|steam:[0-9]+)$/.test(id)
      || /[. ]$/.test(id) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) {
      throw new Error('unsafe game id');
    }
    return Spoofer.safeName(id);
  }

  /** Check containment before creating directories; existing symlinks must not redirect writes. */
  runtimeTarget(...parts) {
    const root = path.resolve(this.config.runtimePath);
    const target = path.resolve(root, ...parts);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('unsafe runtime path');
    }
    let current = root;
    for (const part of ['', ...relative.split(path.sep)]) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('unsafe runtime symlink');
      } catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    return target;
  }

  static fileHash(file) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let size;
      while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        hash.update(buffer.subarray(0, size));
      }
      return hash.digest('hex');
    } finally { fs.closeSync(fd); }
  }

  compiledMatches(target, name) {
    const stamp = this.compiledCache.get(target);
    if (!stamp || stamp.name !== name || stamp.build !== PLACEHOLDER_BUILD) return false;
    try {
      this.runtimeTarget(path.relative(this.config.runtimePath, target));
      const stat = fs.lstatSync(target);
      return stat.isFile() && stat.nlink === 1 && Spoofer.fileHash(target) === stamp.hash;
    } catch (err) { return false; }
  }

  rememberCompiled(target, name) {
    this.compiledCache.set(target, { name, build: PLACEHOLDER_BUILD, hash: Spoofer.fileHash(target) });
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
   * Info.plist for a placeholder bundle.
   *
   * There is deliberately no LSBackgroundOnly here: it used to be set, and it stops the bundle
   * from ever putting a window on screen - which is exactly what the compiled tier needs to do.
   * NSPrincipalClass is what lets the process register as a real application, so it turns up in
   * NSWorkspace's runningApplications the way a game does. The Node tier ignores all of it.
   */
  static bundlePlist(binaryName, gameId) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      '  <key>CFBundleExecutable</key><string>' + binaryName + '</string>',
      '  <key>CFBundleName</key><string>' + binaryName + '</string>',
      '  <key>CFBundleIdentifier</key><string>com.discordquestfaker.g' + gameId + '</string>',
      '  <key>CFBundlePackageType</key><string>APPL</string>',
      '  <key>NSPrincipalClass</key><string>NSApplication</string>',
      '  <key>NSHighResolutionCapable</key><true/>',
      '</dict></plist>'
    ].join('\n');
  }

  /**
   * Create - or reuse - the .app bundle at `bundleDir` carrying `plist` as its Info.plist,
   * and return its Contents/MacOS directory.
   *
   * Once macOS has launched anything out of a bundle it stamps the bundle with
   * com.apple.provenance, and App Management protection then refuses every write inside it.
   * Rewriting Info.plist fails with EPERM from that point on, which used to end the session on
   * its first restart. An unchanged plist needs no write at all; a changed one is handled by
   * dropping the whole bundle - removing it is still permitted - and building it again.
   */
  static writeBundle(bundleDir, plist) {
    const plistPath = path.join(bundleDir, 'Contents', 'Info.plist');
    const macosDir = path.join(bundleDir, 'Contents', 'MacOS');
    let current = null;
    try { current = fs.readFileSync(plistPath, 'utf8'); } catch (err) { /* not built yet */ }

    if (current === plist) {
      if (!fs.existsSync(macosDir)) fs.mkdirSync(macosDir, { recursive: true });
      return macosDir;
    }
    if (current !== null) fs.rmSync(bundleDir, { recursive: true, force: true });

    fs.mkdirSync(macosDir, { recursive: true });
    fs.writeFileSync(plistPath, plist, 'utf8');
    return macosDir;
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
    if (!base || relative.split('/').some((part) => part === '..')
      || base === '.' || base === '..' || /[\x00-\x1f<>:"|?*]/.test(relative)
      || relative.split('/').some((part) => part !== '.' && /[. ]$/.test(part))) {
      throw new Error('unsafe executable name: ' + exe.name);
    }
    const gameDirName = Spoofer.gameDirectory(game.id);
    const parents = (dir === '.' ? [] : dir.split('/')).filter((p) => p && p !== '.' && p !== '..');
    let target;

    if (exe.os === 'darwin' && base.toLowerCase().endsWith('.app')) {
      // macOS entries point at an app bundle, so recreate a minimal one: the running process
      // path then ends with Foo.app/Contents/MacOS/Foo exactly like the real game.
      const binaryName = base.slice(0, -4);
      if (!binaryName || binaryName === '.' || binaryName === '..') throw new Error('unsafe executable name');
      const bundleDir = this.runtimeTarget(gameDirName, ...parents, base);
      this.runtimeTarget(gameDirName, ...parents, base, 'Contents', 'MacOS', binaryName);
      this.runtimeTarget(gameDirName, ...parents, base, 'Contents', 'Info.plist');
      const macosDir = Spoofer.writeBundle(bundleDir, Spoofer.bundlePlist(binaryName, game.id));
      target = path.join(macosDir, binaryName);
    } else {
      const gameDir = this.runtimeTarget(gameDirName, ...parents);
      target = this.runtimeTarget(gameDirName, ...parents, base);
      fs.mkdirSync(gameDir, { recursive: true });
    }

    return target;
  }

  /**
   * Put a working placeholder at `target` using the given tier and return the arguments it
   * needs. Throws if this tier cannot be used, which makes the caller try the next one.
   */
  provision(target, tier, game, exe, session) {
    if (tier === 'compiled') {
      this.compile(target, game);
      // The Linux window draws no picture - decoding one needs a library this has none of - so
      // it does not ask for one either: starting a game must not fetch bytes nobody looks at.
      const icon = process.platform === 'linux' ? null : this.ensureIcon(game);
      // What the window shows about this particular run travels as arguments, so the compiled
      // file stays the same across sessions and does not have to be rebuilt for each one.
      return {
        args: [
          '--icon', icon || '-',
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

  /** Verify against the trusted source, or replace atomically. Never execute an unverified file. */
  copyBinary(source, target) {
    this.runtimeTarget(path.relative(this.config.runtimePath, target));
    const hash = Spoofer.fileHash(source);
    try {
      const stat = fs.lstatSync(target);
      if (stat.isFile() && stat.nlink === 1 && Spoofer.fileHash(target) === hash) {
        if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
        return target;
      }
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const temp = target + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
    try {
      fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
      if (Spoofer.fileHash(temp) !== hash) throw new Error('placeholder integrity check failed');
      if (process.platform !== 'win32') fs.chmodSync(temp, 0o755);
      fs.renameSync(temp, target);
    } finally {
      try { fs.unlinkSync(temp); } catch (err) { if (err.code !== 'ENOENT') throw err; }
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
      restarts: 0,
      tierDeaths: 0
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

        // Say this out loud rather than reporting a bare success: a windowless placeholder is
        // the tier that Discord was never confirmed to detect.
        if (!plan.hasWindow) {
          if (process.platform === 'win32') {
            console.warn('[spoof] ' + label + ': the ' + tiers[i] + ' placeholder has no window, '
              + 'so Discord may not detect it (install the .NET Framework so csc.exe is available)');
          } else if (process.platform === 'darwin') {
            console.warn('[spoof] ' + label + ': the ' + tiers[i] + ' placeholder has no window, '
              + 'so Discord may not detect it (run xcode-select --install so clang and the Cocoa '
              + 'SDK are available)');
          } else if (process.platform === 'linux') {
            console.warn('[spoof] ' + label + ': the ' + tiers[i] + ' placeholder has no window, '
              + 'so all you get is a process (the windowed one needs a C compiler - cc, gcc or '
              + 'clang - and an X or XWayland session, i.e. DISPLAY set)');
          } else {
            this.warnOnce('[spoof] the ' + process.platform + ' placeholder owns no window, and '
              + 'there is no windowed tier for this platform. Whether Discord detects a windowless '
              + 'process here is unverified, so a quest that never moves is a known limit rather '
              + 'than a crash.');
          }
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

        if (session.tier !== i) session.tierDeaths = 0; // a fresh tier starts with a clean slate
        session.path = fakePath;
        session.pid = child.pid;
        session.child = child;
        session.tier = i;
        session.launchedAt = Date.now();

        child.on('error', (err) => {
          if (session.child !== child || session.stopping) return;
          console.error('[spoof] ' + label + ': ' + tiers[i] + ' placeholder failed to start (' + err.message + ')');
          if (!retry(i + 1)) this.cleanup(session, 'failed');
        });

        child.on('exit', (code, signal) => {
          if (session.child !== child) return; // superseded by another launch
          if (session.stopping) {
            this.cleanup(session);
            return;
          }

          const aliveMs = Date.now() - session.launchedAt;
          // code === null means a signal ended it, which is no cleaner than a non-zero code.
          const abnormal = code !== 0;

          // A placeholder that dies at once was refused (policy, a bad argument) rather than
          // stopped - move down to the next tier instead of giving up.
          if (abnormal && aliveMs < 2000) {
            console.error('[spoof] ' + label + ': ' + tiers[i] + ' placeholder exited with code ' + code);
            if (!retry(i + 1)) this.cleanup(session, 'failed');
            return;
          }

          // A tier the OS keeps killing will not start working on the next attempt, and the kill
          // can land long past the grace period above: macOS took anywhere from 4 to 113 seconds
          // to SIGKILL a copied platform binary. Restart a couple of times in case the death was
          // a one-off, then move down a tier instead of restarting the same doomed placeholder.
          if (abnormal && plan.restartOnExit) {
            session.tierDeaths += 1;
            if (session.tierDeaths >= MAX_TIER_DEATHS) {
              const killed = '[spoof] ' + label + ': the ' + tiers[i] + ' placeholder keeps being '
                + 'killed (' + session.tierDeaths + 'x, last: code=' + code + ' signal=' + signal + ')';
              if (i + 1 < tiers.length) {
                console.error(killed + ' - falling back to the ' + tiers[i + 1] + ' placeholder');
                if (retry(i + 1)) return;
              } else {
                // Nothing better to switch to, so the restart below still runs - but say plainly
                // that it is futile instead of letting the log look like normal churn.
                this.warnOnce('[spoof] ' + label + ': the ' + tiers[i] + ' placeholder keeps being '
                  + 'killed and it is the last tier available, so this session will go on '
                  + 'restarting it without ever being detected');
              }
            }
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
            // A windowed placeholder normally exits with code 0 when its window is closed.
            // A non-zero code past the 2s grace period is a crash (e.g. an unhandled exception
            // in the compiled placeholder), not a user closing the window - say so, since the
            // session still ends either way and the log line is the only trace of which one it was.
            console.log(code === 0
              ? '[spoof] ' + label + ': window closed - session ended'
              : '[spoof] ' + label + ': placeholder crashed unexpectedly (code=' + code + ') - session ended');
          }

          console.log('[spoof] ' + label + ' stopped running (code=' + code + ' signal=' + signal + ')');
          this.cleanup(session, code === 0 ? 'exited' : 'crashed');
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
        // the queue runner tells "its timer ran out" from "someone pressed Stop" by this
        session.endReason = 'duration';
        this.stop(key);
      }, session.durationMinutes * 60000);
      if (session.timer.unref) session.timer.unref();
    }

    this.running.set(key, session);
    console.log('[spoof] started "' + game.name + '" as ' + exe.name
      + ' (pid ' + session.pid + ', ' + tiers[session.tier] + ' placeholder)');
    return { ok: true, executable: exe.name, session: this.describe(session) };
  }

  /** Print a platform-level caveat once per run rather than on every session. */
  warnOnce(message) {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(message);
  }

  /**
   * Be told when a session ends, whichever way it ended (its timer ran out, someone pressed
   * Stop, the placeholder's window was closed, it crashed). The queue runner uses this to know
   * when to start the next game; without it nothing outside `running` can tell.
   * @param {(info: object) => void} fn receives describe(session) plus a `reason`
   */
  onSessionEnd(fn) {
    if (typeof fn === 'function') this.endListeners.push(fn);
  }

  /**
   * @param {object} session
   * @param {string} [reason] 'duration' | 'stopped' | 'exited' | 'crashed' | 'failed' -
   *   only used when nothing has already recorded a more specific one.
   */
  cleanup(session, reason) {
    if (session.timer) clearTimeout(session.timer);
    if (!session.endReason) session.endReason = reason || 'exited';
    const current = this.running.get(session.key);
    // A session that was superseded by another launch never left `running`, so it never ended.
    if (!current || current.pid !== session.pid) return;
    this.running.delete(session.key);

    const info = Object.assign(this.describe(session), { reason: session.endReason });
    // A listener that throws must not take down a stop() or an exit handler mid-way.
    this.endListeners.forEach((fn) => {
      try {
        fn(info);
      } catch (err) {
        console.error('[spoof] session-end listener failed: ' + err.message);
      }
    });
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

    this.cleanup(session, 'stopped');
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
