# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local tool that fetches Discord's detectable-game list and spawns placeholder processes that
impersonate a game's executable, so Discord's game detection reports the game as running and
"play game X" quests progress. Node.js only — **zero npm dependencies**, so `npm install` is
never needed. The README is written in Thai and carries the user-facing details.

## Commands

```bash
node src/index.js                 # control panel at http://127.0.0.1:5011 + opens a browser
node src/index.js --headless      # same, no browser (use this when driving it from a script)
node src/index.js --port 8080
node src/index.js --refresh       # rewrite data/games.json from Discord, then exit
node src/index.js --list <query>  # matching games + the executable index used by --exe
node src/index.js --start "<game>" --exe <all|name|index> --duration <minutes>
node src/index.js --add-steam <steam app id or URL> [--force]
node src/index.js --help
```

There is no test runner, linter, or build step. Verification is manual:

```bash
node --check src/spoof.js         # syntax check a file
```

Behaviour is verified against the OS, not through unit tests. The checks that matter:

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

## Architecture

Five modules under `src/`, wired together in `index.js`:

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
- **server.js** — zero-dependency `http` server, static files from `src/public/`, JSON API under
  `/api/`: `state`, `games`, `custom` (POST/DELETE), `refresh`, `start`, `stop`, `stop-all`,
  `presets` (POST/DELETE), `presets/start`.

The frontend (`src/public/`) is plain HTML/CSS/JS, no framework or build.

## How the spoofing works (the parts that are easy to get wrong)

Three constraints were each learned by breaking them. Do not "simplify" past them:

1. **The placeholder must own a visible window.** Discord looks for a process that owns a window,
   not merely a process whose file name matches. A silent, windowless process is never detected.
   The primary tier compiles a real 5 KB WinForms app with `csc.exe` (ships with the .NET
   Framework) whose message loop keeps a titled window open, and it is spawned with
   `windowsHide: false`. This mirrors what `discord-quest-completer`'s WinAPI runner does
   (`CreateWindowExW` + `ShowWindow(SW_SHOWNORMAL)` + message loop).
2. **The executable path must match the detectable entry's tail, not just its basename.**
   Entries like `_retail_/wow-64.exe` or `garenalolth/gamedata/apps/lolth/lolex.exe` need their
   directory prefix recreated under `data/runtime/<game id>/`. macOS `.app` entries get a minimal
   bundle so the path ends `Foo.app/Contents/MacOS/Foo`.
3. **The file's own identity matters.** A renamed copy of `waitfor.exe` still reports
   `OriginalFilename: waitfor.exe` / Microsoft as its publisher. The compiled placeholder embeds
   the game name in its assembly attributes and is compiled straight to its final path so
   `OriginalFilename` is the game's executable name.

`Spoofer.tiers()` is the fallback chain: `compiled` → `system` (`waitfor.exe` / `/bin/sleep`) →
`node` (a copy of the running Node binary + `keepalive.js`). Only the compiled tier has a window;
the others log a warning saying detection may fail. A tier that throws or whose process dies
within 2 s drops to the next tier automatically.

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
  `C:\Program Files` fails with EPERM for standard users).
- Stopping uses `taskkill /T /F` on Windows; `stopAll(true)` is the synchronous variant used
  during shutdown, because async kills do not survive `process.exit`.

## Domain facts worth keeping

- Discord maps a detected process to one application id, so running several executables of the
  same game gives no extra quest progress — the UI deliberately starts a single one.
- The detectable list is overwhelmingly Windows: 10,447 games have a win32 executable, 62 have
  darwin, 8 have linux. A Mac therefore sees almost nothing by default. `osKey: 'all'`
  (UI "All platforms", CLI `--exe-os all`) lifts the per-OS filter so a Mac can create and run a
  file literally named `foo.exe` — extensions are meaningless on Unix. Whether Discord's macOS
  client matches win32 entries is **unverified**; the option exists so it can be tested. The
  macOS placeholder also has no window, which is a second untested variable there.
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
