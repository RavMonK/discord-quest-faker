'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Spoofer } = require('../src/spoof');
const { OS_KEY } = require('../src/games');

function tmpSpoofer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-spoof-'));
  return new Spoofer({ runtimePath: dir, maxConcurrent: 12, defaultDurationMinutes: 0 });
}

test('safeName: strips filesystem-unsafe characters from arbitrary ids', () => {
  assert.equal(Spoofer.safeName('steam:3787240'), 'steam_3787240');
  assert.equal(Spoofer.safeName('../../etc'), '.._.._etc');
  assert.equal(Spoofer.safeName('normal_Name-1.2'), 'normal_Name-1.2');
});

test('signalToken: alphanumeric only (waitfor signal names allow nothing else)', () => {
  const token = Spoofer.signalToken('steam:123', 'weird name!@#.exe');
  assert.match(token, /^[0-9a-zA-Z]+$/);
  assert.match(token, /^DQFsteam123/i);
});

test('signalToken: is deterministic and differs for different executables of the same game', () => {
  const a = Spoofer.signalToken('42', 'game.exe');
  const b = Spoofer.signalToken('42', 'launcher.exe');
  assert.equal(Spoofer.signalToken('42', 'game.exe'), a); // deterministic
  assert.notEqual(a, b);
});

test('candidates: filters to the requested OS and dedupes case-insensitively', () => {
  const game = {
    executables: [
      { name: 'Game.exe', os: 'win32', isLauncher: false },
      { name: 'game.exe', os: 'win32', isLauncher: false }, // duplicate, different case
      { name: 'launcher.exe', os: 'win32', isLauncher: true },
      { name: 'Game', os: 'darwin', isLauncher: false }
    ]
  };
  const win32 = Spoofer.candidates(game, 'win32');
  assert.equal(win32.length, 2);
  assert.equal(win32[win32.length - 1].isLauncher, true); // launchers sort last

  const darwin = Spoofer.candidates(game, 'darwin');
  assert.equal(darwin.length, 1);
});

test('select: "all" returns every candidate, a name returns a match, an out-of-range index returns nothing', () => {
  // select() offers this platform's executables only, so the fixture has to speak its OS -
  // hard-coding win32 here made the test pass on Windows and fail everywhere else.
  const game = { executables: [
    { name: 'a.exe', os: OS_KEY, isLauncher: false },
    { name: 'b.exe', os: OS_KEY, isLauncher: false }
  ] };

  assert.equal(Spoofer.select(game, 'all').length, 2);
  assert.deepEqual(Spoofer.select(game, 'b.exe').map((e) => e.name), ['b.exe']);
  assert.deepEqual(Spoofer.select(game, 1).map((e) => e.name), ['b.exe']);
  assert.deepEqual(Spoofer.select(game, 99), []);
  assert.deepEqual(Spoofer.select(game, undefined).map((e) => e.name), ['a.exe']); // default: first
});

test('materialize: recreates the directory prefix so Discord\'s path-tail match still works', () => {
  const spoofer = tmpSpoofer();
  const target = spoofer.materialize({ id: 'wow' }, { name: '_retail_/wow-64.exe', os: 'win32' });
  assert.equal(path.basename(target), 'wow-64.exe');
  assert.equal(path.basename(path.dirname(target)), '_retail_');
  assert.ok(fs.existsSync(path.dirname(target))); // directory was created
});

test('materialize: builds a minimal macOS bundle so the path ends Foo.app/Contents/MacOS/Foo', () => {
  const spoofer = tmpSpoofer();
  const target = spoofer.materialize({ id: 'mac1' }, { name: 'Foo.app', os: 'darwin' });
  assert.ok(target.replace(/\\/g, '/').endsWith('Foo.app/Contents/MacOS/Foo'));
  assert.ok(fs.existsSync(path.join(path.dirname(path.dirname(target)), 'Info.plist')));
});

test('materialize: reuses an unchanged macOS bundle instead of rewriting its Info.plist', () => {
  // Once macOS has launched a bundle, App Management protection makes every write inside it
  // fail with EPERM - so a second materialize() of the same executable must not write at all.
  const spoofer = tmpSpoofer();
  const exe = { name: 'Foo.app', os: 'darwin' };
  const first = spoofer.materialize({ id: 'mac2' }, exe);
  const plist = path.join(path.dirname(path.dirname(first)), 'Info.plist');
  const before = fs.statSync(plist);

  const second = spoofer.materialize({ id: 'mac2' }, exe);
  assert.equal(second, first);
  assert.equal(fs.statSync(plist).ino, before.ino); // same file, never replaced
  assert.equal(fs.statSync(plist).mtimeMs, before.mtimeMs); // and never written to
});

test('writeBundle: rebuilds the bundle from scratch when the Info.plist has changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-bundle-'));
  const bundle = path.join(dir, 'Foo.app');
  const macos = Spoofer.writeBundle(bundle, '<plist>one</plist>');
  fs.writeFileSync(path.join(macos, 'stale'), 'left over from the old bundle');

  const again = Spoofer.writeBundle(bundle, '<plist>two</plist>');
  assert.equal(again, macos);
  assert.equal(fs.readFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'utf8'), '<plist>two</plist>');
  assert.equal(fs.existsSync(path.join(macos, 'stale')), false); // the whole bundle was replaced
});

test('tiers: every platform ends at node, and macOS never offers the system placeholder', () => {
  const tiers = Spoofer.tiers();
  assert.equal(tiers[tiers.length - 1], 'node'); // the last resort is the same everywhere
  if (process.platform === 'darwin') {
    // A copied /bin/sleep is SIGKILLed by macOS, so that tier must not be on offer - and the
    // windowed placeholder has to be tried before the windowless fallback.
    assert.deepEqual(tiers, ['compiled', 'node']);
  } else if (process.platform === 'win32' || process.platform === 'linux') {
    // Linux compiles an X11 window too, and keeps the copied /bin/sleep for machines that
    // have no compiler or no display.
    assert.deepEqual(tiers, ['compiled', 'system', 'node']);
  } else {
    assert.deepEqual(tiers, ['system', 'node']);
  }
});

test('bundlePlist: declares a GUI app - LSBackgroundOnly would stop the window ever appearing', () => {
  const plist = Spoofer.bundlePlist('Foo', '42');
  assert.match(plist, /<key>CFBundleExecutable<\/key><string>Foo<\/string>/);
  assert.match(plist, /<key>NSPrincipalClass<\/key><string>NSApplication<\/string>/);
  assert.equal(/LSBackgroundOnly/.test(plist), false);
});

test('rebuildBundle: replaces the whole bundle, which is the only way into a protected one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-rebuild-'));
  const target = path.join(dir, 'Foo.app', 'Contents', 'MacOS', 'Foo');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'the old binary');
  fs.writeFileSync(path.join(dir, 'Foo.app', 'Contents', 'stale'), 'left behind');

  const macosDir = Spoofer.rebuildBundle(target, '42');
  assert.equal(macosDir, path.dirname(target));
  assert.ok(fs.existsSync(macosDir)); // ready for the binary to be copied in
  assert.equal(fs.existsSync(target), false); // the old binary went with the bundle
  assert.equal(fs.existsSync(path.join(dir, 'Foo.app', 'Contents', 'stale')), false);
  assert.match(fs.readFileSync(path.join(dir, 'Foo.app', 'Contents', 'Info.plist'), 'utf8'),
    /<key>CFBundleExecutable<\/key><string>Foo<\/string>/);
});

test('rebuildBundle: refuses a path that is not inside a .app rather than deleting two levels up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-rebuild-'));
  const loose = path.join(dir, 'some', 'where', 'Foo');
  fs.mkdirSync(path.dirname(loose), { recursive: true });
  assert.throws(() => Spoofer.rebuildBundle(loose, '42'), /not one that can be rebuilt/);
  assert.ok(fs.existsSync(path.dirname(loose))); // nothing was removed
});

test('cString: neutralises quotes and backslashes so an API name cannot break the source', () => {
  assert.equal(Spoofer.cString('Say "hi"'), 'Say \\"hi\\"');
  assert.equal(Spoofer.cString('back\\slash'), 'back\\\\slash');
  assert.equal(Spoofer.cString('two\nlines'), 'two lines');
  assert.equal(Spoofer.cString(''), 'Game');
});

test('asciiLabel: folds accents away, because a core X font draws single bytes only', () => {
  assert.equal(Spoofer.asciiLabel('MARVEL T\u014dkon'), 'MARVEL Tokon');
  assert.equal(Spoofer.asciiLabel('Pok\u00e9mon Unite'), 'Pokemon Unite');
  // Nothing left to draw: the file name being impersonated is a better label than an empty one.
  assert.equal(Spoofer.asciiLabel('\u539f\u795e', 'yuanshen.x86_64'), 'yuanshen.x86_64');
  assert.equal(Spoofer.asciiLabel('', 'fallback'), 'fallback');
});

test('linuxSource: compiles in the escaped name, the folded label and nothing else', () => {
  const source = Spoofer.linuxSource(Spoofer.cString('Say "hi"'), 'Say hi', 'game.x86_64', 'S');
  assert.match(source, /static const char \*kName = "Say \\"hi\\"";/);
  assert.match(source, /static const char \*kLabel = "Say hi";/);
  assert.match(source, /static const char \*kFile = "game.x86_64";/);
  // Xlib is reached through dlopen, which is what keeps this tier free of X11 headers and -lX11.
  assert.match(source, /dlopen\("libX11\.so\.6", RTLD_LAZY\)/);
  // The window has to be mapped and named to be a window at all, and the real (UTF-8) name is
  // the one a window manager shows.
  assert.match(source, /XMapWindow\(dpy, win\)/);
  assert.match(source, /_NET_WM_NAME/);
  assert.match(source, /UTF8_STRING/);
  // Closing the window ends the session, so the protocol for being asked to close must be set.
  assert.match(source, /WM_DELETE_WINDOW/);
});

test('linuxCompiler: takes the first compiler on PATH and honours $CC', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqf-cc-'));
  const { PATH, CC } = process.env;
  try {
    process.env.PATH = dir;
    delete process.env.CC;
    assert.equal(Spoofer.linuxCompiler(), null); // an empty PATH has no compiler to find

    const gcc = path.join(dir, 'gcc');
    fs.writeFileSync(gcc, '#!/bin/sh\n');
    fs.chmodSync(gcc, 0o755);
    assert.equal(Spoofer.linuxCompiler(), gcc);

    const own = path.join(dir, 'my-cc');
    fs.writeFileSync(own, '#!/bin/sh\n');
    fs.chmodSync(own, 0o755);
    process.env.CC = own;
    assert.equal(Spoofer.linuxCompiler(), own); // $CC wins over anything on PATH
  } finally {
    process.env.PATH = PATH;
    if (CC === undefined) delete process.env.CC; else process.env.CC = CC;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('materialize: rejects a ".." executable name instead of escaping the per-game directory', () => {
  const spoofer = tmpSpoofer();
  assert.throws(
    () => spoofer.materialize({ id: 'evil' }, { name: 'sub/..', os: 'win32' }),
    /unsafe executable name/
  );
});

test('materialize: rejects an executable name that resolves to "."', () => {
  const spoofer = tmpSpoofer();
  assert.throws(
    () => spoofer.materialize({ id: 'evil2' }, { name: 'sub/.', os: 'win32' }),
    /unsafe executable name/
  );
});

test('startOne: refuses a second start of the same game+executable while one is running', () => {
  const spoofer = tmpSpoofer();
  // Fake a running session directly rather than spawning a real placeholder process.
  const key = Spoofer.sessionKey('99', 'game.exe');
  spoofer.running.set(key, { key, gameId: '99', name: 'Fake', executable: 'game.exe', pid: 1234, startedAt: Date.now(), durationMinutes: 0, restarts: 0 });

  const result = spoofer.startOne({ id: '99', name: 'Fake' }, { name: 'game.exe', os: 'win32' }, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /already running/);
});

test('startOne: refuses to exceed maxConcurrent', () => {
  const spoofer = tmpSpoofer();
  spoofer.config.maxConcurrent = 1;
  spoofer.running.set('existing::x.exe', { key: 'existing::x.exe' });

  const result = spoofer.startOne({ id: 'new', name: 'New' }, { name: 'y.exe', os: 'win32' }, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /limit reached/);
});
