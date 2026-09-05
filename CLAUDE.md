# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local tool that fetches Discord's detectable-game list and spawns placeholder processes that
impersonate a game's executable, so Discord's game detection reports the game as running and
"play game X" quests progress. Node.js only — **zero npm dependencies**, so `npm install` is
never needed. The README exists twice — `README.md` (Thai) and `README.en.md` (English), mirrors
of each other — and both are deliberately short: a warning, a quick start, and an index into the
wiki. All user-facing detail lives in `wiki/` — 13 topics, each as a `TH-*.md` / `EN-*.md` pair,
synced to the GitHub wiki (see `wiki/README.md`). A change to user-visible behaviour belongs in
both wiki languages; touch the READMEs only when the quick start or the warning changes, and then
in both of them.

## Commands

```bash
node src/index.js                 # control panel at http://127.0.0.1:5011 + opens a browser
node src/index.js --headless      # same, no browser (use this when driving it from a script)
node src/index.js --port 8080
node src/index.js --refresh       # rewrite data/games.json from Discord, then exit
node src/index.js --list <query>  # matching games + the executable index used by --exe
node src/index.js --start "<game>" --exe <all|name|index> --duration <minutes>
node src/index.js --queue          # play config.json's queue, one game at a time
node src/index.js --add-steam <steam app id or URL> [--force]
node src/index.js --help
```

There is no linter or build step. A test suite exists but is deliberately narrow:

```bash
npm test                          # node's built-in test runner (node:test), zero deps added
node --check src/spoof.js         # syntax check a file
```

`tests/` covers only pure, deterministic logic that is safe to run without touching the real
project state: `games.js`'s `normalize()`/`fold()`/`GameStore` (constructed with a temp-dir
config, never the real `config.json`), `spoof.js`'s path/name helpers (`materialize()`,
`writeBundle()`, `bundlePlist()`, `rebuildBundle()`, `safeName()`, `signalToken()`, `cString()`,
`asciiLabel()`, `linuxCompiler()`, `linuxSource()`, `candidates()`/`select()`), the per-platform
shape of `tiers()`, and `startOne()`'s synchronous guards (already-running, `maxConcurrent`), `steam.js`'s parsing (`parseAppId`, `normalizeExecutable`,
`executablesInArguments`, `osKeysFor`), and `queue.js` (`randomBetween`/`clampSeconds`, the list
operations, and the whole advance cycle against a stub spoofer - the queue takes its `save` as a
constructor argument precisely so a test never writes the real `config.json`). It deliberately does **not** cover: `config.js`'s
`load()`/`save()` (they hardcode the real `config.json` path under the project root — there is no
way to point them at a temp file, so testing them would risk clobbering the user's actual config),
anything that spawns a real placeholder or invokes `csc.exe` (OS/environment-dependent, exactly
what the manual OS checks below are for), and the `src/public/` frontend (plain browser script
with no module exports and no DOM in the test process — simulating one would mean adding a
dependency like jsdom, which breaks the zero-npm-deps rule). Behaviour beyond that boundary is
still verified against the OS, not through unit tests. The checks that matter:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } |
  Select-Object ProcessId, Name, ExecutablePath          # is the fake process really running
(Get-Process -Id <pid>).MainWindowHandle                 # non-zero == it owns a window
(Get-Item <path>).VersionInfo                            # what the file claims to be
```

Kill leftovers between runs — a crashed server can leave placeholders behind:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

On Linux the checks are cheap, and the window is worth checking because it is new:

```bash
for d in /proc/[0-9]*; do case "$(readlink $d/exe)" in *data/runtime*) echo "${d#/proc/} -> $(readlink $d/exe)";; esac; done
xwininfo -root -tree | grep -i <game>        # must list the game at 480x160
xprop -id <window id> _NET_WM_PID WM_CLASS   # the pid must be the placeholder's
pkill -f "data/runtime"                      # clean up leftovers
```

On macOS the equivalent checks are different, and one of them is not optional. `ps` is useless
for reading a placeholder's path (`keepalive.js` sets `process.title`, which overwrites the argv
the process table shows), and `pgrep -f` matches your own shell command line, so it happily
reports a placeholder that is not running. Ask the kernel the same question Discord asks —
`proc_pidpath()` — and check the copy really is a copy:

```bash
lsappinfo list | grep -A4 -i <game>.app      # must say type="Foreground" with the fake paths
stat -f "links=%l inode=%i" <path>           # links must be 1: a hard link breaks the next check
python3 -c "import ctypes,ctypes.util,sys
libc=ctypes.CDLL(ctypes.util.find_library('c')); b=ctypes.create_string_buffer(4096)
libc.proc_pidpath(ctypes.c_int(int(sys.argv[1])),b,4096); print(b.value.decode())" <pid>
```

Whether it owns a window is the other half, and it is the same call Discord makes. Compile this
once with the `swiftc` that comes with the Command Line Tools:

```swift
import CoreGraphics; import Foundation
let target = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                      kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowOwnerPID as String] as? Int) == target {
  print("onscreen=\(w[kCGWindowIsOnscreen as String] ?? false) layer=\(w[kCGWindowLayer as String] ?? -1)")
}
```

`onscreen=true layer=0` is a normal application window. No output at all means the process owns
none, which is the windowless Node fallback. Window titles read back as empty without Screen
Recording permission — that is expected and does not mean the window is missing.

That last one must print the fake game path. If it prints the path of the Node binary instead,
Discord sees a process called `node` and detection cannot work. When a placeholder dies on its
own, macOS files the reason in `~/Library/Logs/DiagnosticReports/<name>-*.ips` — read `exception`
and `termination` out of the JSON body; a `CODESIGNING` / `Launch Constraint Violation` entry
there is the OS refusing to run the file at all.

## Architecture

Six modules under `src/`, wired together in `index.js`:

- **config.js** — loads/saves `config.json`. Two rules encoded here: BOM-prefixed JSON is
  tolerated (Windows editors write it), and a file that fails to parse is never overwritten
  (`save()` returns null instead). CLI overrides like `--port`/`--headless` are applied to the
  live config only; `fileState` holds what belongs on disk so flags never leak into the file.
  Only `EDITABLE_KEYS` are written back.
- **games.js** — `GameStore` keeps three lists: `detectable` (from Discord), `custom` (added by
  hand, in `data/custom-games.json`), and `games` (the merge that everything else reads). A list
  refresh replaces `detectable` and re-merges, so custom entries survive. `fold()` strips accents
  for search — without it "marvel tokon" cannot find "MARVEL Tōkon".
- **steam.js** — resolves a Steam app id/URL to the same game shape via `api.steamcmd.net`
  (steamdb.info itself returns 403 to automated requests; the appinfo data is the same).
- **spoof.js** — the actual spoofing. See below.
- **queue.js** — `QuestQueue` plays a list of games one at a time: it starts an entry with that
  entry's own auto-stop time and, when the session ends, waits a random number of seconds before
  the next one. Three things hold it up. `Spoofer.onSessionEnd()` is the only way to learn that a
  session ended on its own, and the queue reacts only to the session key it started, so a game
  someone starts by hand never moves it. The gap is drawn per gap from `crypto.randomInt` - a
  fixed wait, or one number reused for a whole run, is exactly the pattern the range exists to
  avoid. And `stop()` clears `running` *before* killing the placeholder, because the kill fires
  that same callback and the queue would otherwise read its own Stop as "the game finished" and
  start the next one. Shutdown stops the queue first and with the **synchronous** kill, since an
  async `taskkill` never runs once `process.exit` is on its way.
- **server.js** — zero-dependency `http` server, static files from `src/public/`, JSON API under
  `/api/`: `state`, `games`, `custom` (POST/DELETE), `refresh`, `start`, `stop`, `stop-all`,
  `presets` (POST/DELETE), and `queue` (POST/PATCH/DELETE) with `queue/move`, `queue/start`,
  `queue/stop`, `queue/skip`, `queue/settings`. `stop-all` stops the queue too - otherwise it
  starts the next game seconds later and the button looks broken.

The frontend (`src/public/`) is plain HTML/CSS/JS, no framework or build.

## How the spoofing works (the parts that are easy to get wrong)

Three constraints were each learned by breaking them. Do not "simplify" past them:

1. **The placeholder must own a visible window.** Discord looks for a process that owns a window,
   not merely a process whose file name matches. A silent, windowless process is never detected.
   The primary tier compiles a real 5 KB WinForms app with `csc.exe` (ships with the .NET
   Framework) whose message loop keeps a titled window open, and it is spawned with
   `windowsHide: false`. This mirrors what `discord-quest-completer`'s WinAPI runner does
   (`CreateWindowExW` + `ShowWindow(SW_SHOWNORMAL)` + message loop). macOS has the same
   requirement and its own answer: `compileMac()` builds a ~56 KB Cocoa app (clang + the Cocoa
   SDK from the Xcode Command Line Tools) that runs `NSApplication` at
   `NSApplicationActivationPolicyRegular` and holds an `NSWindow` on screen. What that window *shows*
   (game icon, elapsed clock, auto-stop countdown) arrives as command line arguments
   (`--icon <path|-> --started <epoch ms> --duration <minutes>`), never compiled in, so one
   build serves every session and the ~800 ms compile stays cached. Changing the C# source
   means bumping `PLACEHOLDER_BUILD` — the stamp file is what decides a rebuild.
   `ensureIcon()` downloads the icon once into `data/runtime/_icons/` in the background and
   returns the path immediately; the window polls for the file for ~90 s and otherwise shows
   the game's initial. Starting a game must never wait on a CDN.
   Linux answers the same requirement with `compileLinux()`: a ~72 KB X11 program built by any
   C compiler (`$CC`, `cc`, `gcc`, `clang`) that maps one fixed 480x160 window. It reaches Xlib
   through `dlopen("libX11.so.6")` and `dlsym`, deliberately, so the build needs no X11 headers,
   no dev package and no `-lX11` — a plain desktop can build it. That also means there is no
   image decoder: the window shows the game's initial, no icon is downloaded on Linux at all,
   and the drawn text is ASCII-folded (`asciiLabel()`) because a core X font is single byte,
   while the real UTF-8 name goes on the window through `_NET_WM_NAME`. `compileLinux()` refuses
   to build with no `DISPLAY`, which is what sends a headless or Wayland-without-XWayland
   session down to the windowless tiers instead of looping on a placeholder that cannot appear.
2. **The executable path must match the detectable entry's tail, not just its basename.**
   Entries like `_retail_/wow-64.exe` or `garenalolth/gamedata/apps/lolth/lolex.exe` need their
   directory prefix recreated under `data/runtime/<game id>/`. macOS `.app` entries get a minimal
   bundle so the path ends `Foo.app/Contents/MacOS/Foo`.
3. **The file's own identity matters.** A renamed copy of `waitfor.exe` still reports
   `OriginalFilename: waitfor.exe` / Microsoft as its publisher. The compiled placeholder embeds
   the game name in its assembly attributes and is compiled straight to its final path so
   `OriginalFilename` is the game's executable name. The Linux window carries the equivalent for
   a window rather than a file: `WM_CLASS` (executable name + game name), `_NET_WM_PID`, and
   `WM_DELETE_WINDOW` so the window manager asks it to close rather than killing it.

`Spoofer.tiers()` is the fallback chain, and it is not the same on every platform:
Windows gets `compiled` → `system` (`waitfor.exe`) → `node` (a copy of the running Node binary +
`keepalive.js`), Linux gets `compiled` → `system` (`/bin/sleep`) → `node`, and **macOS gets
`compiled` → `node`**.

macOS has no `system` tier because it cannot run a copy of one of its own binaries: Apple's
platform binaries carry a launch constraint tying them to their install path, and the code signing
monitor SIGKILLs the copy — measured anywhere from 4 s to 113 s after launch, with `CODESIGNING` /
`Launch Constraint Violation` in the crash report. Do not put `system` back on darwin; it looks
like it works for a few seconds and then always dies.

`compile()` dispatches to `compileWindows()` (csc.exe), `compileMac()` (clang + Cocoa) or
`compileLinux()` (any C compiler + Xlib through `dlopen`); all three build straight to the
placeholder's final path and cache on a `PLACEHOLDER_BUILD` stamp. Only the `compiled` tier owns
a window, and each platform logs a per-session warning naming what is missing when it falls
through to a windowless one (`.NET Framework` / `xcode-select --install` / a C compiler and a
`DISPLAY`). The generic `warnOnce()` about a platform with no windowed tier at all is now only
reachable on something other than the three.

Two rules move a session down a tier: a placeholder that throws or dies within 2 s was refused
outright, and a placeholder that keeps being killed abnormally `MAX_TIER_DEATHS` (3) times gets
abandoned in favour of the next tier. The second rule exists because the macOS kill lands far
outside the 2 s window — without it the doomed tier was simply restarted forever.

Restart policy differs per tier and is deliberate: `system`/`node` placeholders time out
(`waitfor` caps at 99999 s) and are respawned so a session lasts until it is stopped, while the
windowed `compiled` placeholder exits only when someone closes its window — that counts as a stop
and must not be respawned.

Other invariants in `spoof.js`:

- Sessions are keyed `<game id>::<executable>`, so one game can run several executables at once.
- `waitfor` refuses a signal name already in use, so each session gets a unique `signalToken()`.
  Sharing one token silently kills every executable of a game except the first.
- Game ids can be `steam:<appid>`, and executable names come from third-party APIs, so both are
  sanitised before becoming paths (`..` segments dropped, `:` replaced).
- `copyBinary()` tries a hard link first and falls back to copying (linking from
  `C:\Program Files` fails with EPERM for standard users) — **except on macOS, where it always
  copies**. A hard link shares its inode with the source, and `proc_pidpath()` (the call Discord
  uses to read a process's executable path) then answers with whichever name of that inode the
  kernel's name cache holds. The same placeholder was observed reporting both its fake path and
  `.../node/bin/node`, so detection failed intermittently for no visible reason. A real copy owns
  its inode and has exactly one name.
- The bundle `Info.plist` (`Spoofer.bundlePlist()`) must keep `NSPrincipalClass` and must **not**
  set `LSBackgroundOnly`. It used to set it, which silently prevents the process from ever putting
  a window on screen — the one thing the compiled tier exists to do. The Node tier neither reads
  nor needs any of it, so one plist serves both.
- `Spoofer.rebuildBundle()` is the only way to write into a bundle macOS has protected: it drops
  the whole `.app` and makes an empty one. `installMacBinary()` reaches for it after an
  EPERM/EACCES on the copy, so a recompile still lands. It refuses a path that is not
  `<x>.app/Contents/MacOS/<binary>`, because getting that wrong deletes two directories up.
- `Spoofer.writeBundle()` never rewrites an unchanged `Info.plist`. Once macOS has launched
  anything out of a `.app`, it stamps the bundle `com.apple.provenance` and App Management
  protection refuses every write inside it — even after unlinking the file first. Deleting the
  whole bundle is still allowed, which is the fallback when the plist genuinely has to change.
  This used to end a session on its very first restart with `EPERM ... Info.plist`. Note it is
  path-dependent: bundles under `/private/tmp` are writable, ones under `$HOME` are not, so a
  test in a temp dir will not reproduce it.
- Stopping uses `taskkill /T /F` on Windows; `stopAll(true)` is the synchronous variant used
  during shutdown, because async kills do not survive `process.exit`.

## Domain facts worth keeping

- Discord maps a detected process to one application id, so running several executables of the
  same game gives no extra quest progress — the UI deliberately starts a single one, and a
  preset stores one executable name (never "all"). There is no start-all control anywhere.
- An entry with no auto-stop time (`durationMinutes` 0, and `defaultDurationMinutes` 0 too)
  never ends on its own, so the queue waits on it forever. That is allowed - a session with no
  timer is a legitimate thing to run - but it is warned about in the terminal and on the panel's
  status line rather than silently looking hung.
- Every endpoint that returns presets must go through `describePresets()`: config.json holds
  only id/name/executable, and handing those raw entries to the UI made `renderPresets` throw
  mid-render, blanking the panel until the next poll.
- The detectable list is overwhelmingly Windows: 10,447 games have a win32 executable, 62 have
  darwin, 8 have linux. A Mac therefore sees almost nothing, and a Windows-only game never
  appears there at all. Running win32 entries on macOS was built once and then **deliberately
  removed**: it works technically (extensions mean nothing on Unix) but a `foo.exe` process on
  macOS is impossible for a real game, so it is a trivially detectable spoofing signal. Do not
  reintroduce it. The macOS placeholder also has no window, unlike the Windows one.
- What is verified on Linux: the compiled placeholder really maps a window on X11 (480x160,
  named and classed after the game, `_NET_WM_PID` matching its pid), `/proc/<pid>/exe` is the
  fake game path, and closing the window ends the session. What is **not** verified is whether
  Discord's Linux client credits the quest — same open question as macOS. Discord's Linux
  detection reads `/proc`, which the windowless tiers satisfy too, so the window is there
  because every platform's detection has wanted one so far, not because Linux was proven to.
- What is actually verified on macOS, so nobody re-debugs the wrong half. `discord_utils.node`
  imports `proc_pidpath`, `sysctl`, `proc_pidinfo`, `NSWorkspace`/`NSRunningApplication` and
  `CGWindowListCopyWindowInfo` — five ways of looking at a process — and the compiled placeholder
  answers all three that matter: `proc_pidpath()` reports the game's fake path, `lsappinfo` lists
  it `type="Foreground"` with the right bundle and executable path, and
  `CGWindowListCopyWindowInfo` finds an on-screen window at layer 0. The Node fallback answers
  only the first. What is still **not** verified is the last step — whether Discord then credits
  the quest. Until someone confirms that end to end, do not call macOS working; call it
  detectable-in-principle.
- Any executable in a game's detectable entry works — `cod.exe` and `cod26-cod.exe` both get
  Modern Warfare 4 detected. There is no "correct" one to pick.
- A Steam launch entry's `executable` is frequently just a bootstrapper, with the real game
  binary named in its `arguments` (MW4 beta: `bootstrapper.exe` + `cod26-cod.exe`). `steam.js`
  reads both fields, filtering out argument tokens that are switches — Counter-Strike 2's data
  really does contain `-steam.exe`.
- Steam's names and Discord's list still disagree, and only Discord's ids earn quest progress.
  `findDetectableTwin()` in `server.js` handles that: when an added Steam game matches one
  Discord already tracks, the custom entry is *not* saved and the caller is pointed at Discord's
  entry instead (`--force` overrides).
- `data/` (games cache, custom games, runtime placeholders) and `config.json` are gitignored;
  they are user state, not source.
- A busy control-panel port is not a dead end: `offerToFreePort()` in `index.js` names the
  process holding it and offers to kill it, then retries `listen()`. It only ever asks when
  `process.stdin.isTTY` — `--headless` driven from a script must not kill a process nobody
  agreed to kill. Windows kills with `taskkill /T`, so placeholders a leftover panel spawned
  (its children) go with it.
