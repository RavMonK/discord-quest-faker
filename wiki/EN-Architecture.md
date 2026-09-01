# Architecture

[🏠 Home](Home) · [ไทย](TH-Architecture) · **English**

---

Five modules under `src/`, wired together in `index.js`. No external dependencies, no build step.

```
index.js ── argument parsing, CLI modes, port handling, shutdown signals
   ├── config.js   reads/writes config.json
   ├── games.js    GameStore: fetch, cache, search, merge custom games
   │      └── steam.js   turns Steam appinfo into the same shape as a Discord entry
   ├── spoof.js    Spoofer: materialize placeholders, spawn them, own the sessions
   └── server.js   HTTP API + static files from public/
          └── public/   the control panel (plain HTML/CSS/JS)
```

## Module responsibilities

### `config.js`

Loads/saves `config.json`. Two rules are encoded here:

- **A UTF-8 BOM is tolerated** (Windows editors write it)
- **A file that fails to parse is never overwritten** (`save()` returns `null` instead)

CLI overrides like `--port` / `--headless` apply to the live config only; `fileState` holds what
belongs on disk so flags never leak into the file. Only `EDITABLE_KEYS` are written back.

### `games.js`

`GameStore` keeps three lists:

| List | Source |
|---|---|
| `detectable` | Straight from Discord (cached in `data/games.json`) |
| `custom` | Added by hand (`data/custom-games.json`) |
| `games` | The merge of both — what everything else reads |

A refresh replaces only `detectable` and re-merges, so **custom entries survive**.

- `normalize()` strips the 12 MB payload down to the fields in use and **drops executables
  containing `..`** — the list is developer-submitted, so it is not fully trusted.
- `fold()` strips accents for search; without it `marvel tokon` cannot find `MARVEL Tōkon`.
- Writes are atomic (`.tmp` + rename), and **a failed refresh keeps the old list**.

### `steam.js`

Resolves a Steam app id/URL to the same game shape via `api.steamcmd.net` (steamdb.info itself
returns 403 to automated requests; the appinfo data is the same). Details in
[Steam games](EN-Steam-Games).

### `spoof.js`

The heart of the tool — ~890 lines including the placeholder's C# source, explained in
[How it works](EN-How-It-Works). The methods that matter:

| Method | What it does |
|---|---|
| `tiers()` | The fallback chain: `compiled` → `system` → `node` (no first tier on Unix) |
| `candidates(game)` | This OS's executables, de-duplicated, launchers last |
| `select(game, wanted)` | Resolves `"all"` / a name / an index to a list of executables |
| `materialize(game, exe)` | Builds the placeholder path (directory prefixes, `.app` bundles) |
| `provision(target, tier, ...)` | Creates the placeholder for a tier; returns args + restart policy |
| `compile(target, name)` | Invokes `csc.exe`, with a stamp file preventing needless rebuilds |
| `ensureIcon(game)` | Returns the icon path immediately, downloading in the background |
| `startOne(game, exe, opts)` | Tries each tier until one spawns; wires `exit`/`error`; sets the auto-stop timer |
| `stop(key, sync)` | `taskkill /T /F` on Windows, SIGTERM→SIGKILL on Unix |

### `server.js`

A zero-dependency `http` server: static files from `src/public/`, JSON API under `/api/`.
Endpoint reference in [HTTP API](EN-HTTP-API).

## Data flow: from Start to Discord seeing it

```
panel   POST /api/start { id, executable, durationMinutes }
   └── store.resolve(id)                → find the game entry
   └── spoofer.start(game, opts)
          └── Spoofer.select()          → which executables to run
          └── startOne()
                 ├── already-running + maxConcurrent guards
                 ├── materialize()      → data/runtime/<id>/<exe>
                 ├── provision('compiled')
                 │      ├── compile()   → csc.exe (cached)
                 │      └── ensureIcon()→ background download
                 ├── spawn(fakePath, args, { windowsHide: false })
                 │      → a window appears  ← what Discord looks for
                 └── set the auto-stop timer, if any
   └── respond { ok, sessions, running }
```

Discord scans processes, sees a path ending with one of its entries, and shows the playing status.

## Invariants (each learned by breaking it)

1. **The placeholder must own a visible window** — a silent, windowless process is never
   detected. It has to be spawned with `windowsHide: false`.
2. **The path tail must match, not just the basename** — `_retail_/wow-64.exe` needs its
   directory prefix recreated.
3. **The file's own identity matters** — a renamed `waitfor.exe` still reports itself as
   Microsoft's waitfor, so the compiled placeholder embeds the game name and is compiled straight
   to its final path.
4. **A session is keyed `<game id>::<executable>`** — one game can run several executables at once.
5. **`waitfor` refuses a signal name already in use** — each session needs its own
   `signalToken()`. Sharing one silently kills every executable of a game except the first.
6. **Game ids and executable names are third-party text** — `steam:<appid>` and API-supplied
   names must pass through `safeName()` / `..` filtering before becoming paths.
7. **`copyBinary()` tries a hard link first, then copies** — linking from `C:\Program Files`
   fails with EPERM for standard users.
8. **Restart policy differs per tier, deliberately** — `system`/`node` time out and are
   respawned; a `compiled` placeholder exits because a user closed its window, which counts as a
   stop and **must not be respawned**.
9. **Shutdown must kill synchronously** — `stopAll(true)`, because async kills do not survive
   `process.exit`.
10. **Every endpoint returning presets must go through `describePresets()`** — `config.json`
    holds only id/name/executable, and handing those raw entries to the UI made `renderPresets`
    throw mid-render, blanking the panel until the next poll.
11. **`PLACEHOLDER_BUILD` must be bumped when the C# source changes** — the stamp file is what
    decides a rebuild.
12. **Never reintroduce cross-platform executables** — a `.exe` process on macOS is a trivially
    detectable spoofing signal (see [Platform notes](EN-Platform-Notes)).

## Domain facts worth keeping

- Discord maps a detected process to **one** application id, so running several executables of
  the same game gives no extra progress. The UI starts a single one, a preset stores one
  executable (never `"all"`), and there is no "start all" control anywhere.
- The detectable list is overwhelmingly Windows: **10,447 / 62 / 8** (win32 / darwin / linux).
- **Any executable in a game's entry works** — both `cod.exe` and `cod26-cod.exe` get MW4 detected.
- A Steam launch entry's `executable` is frequently just a bootstrapper, with the real binary
  named in its `arguments`.
- Steam's names and Discord's still disagree, and **only Discord's ids earn quest progress** —
  `findDetectableTwin()` handles that.
- `data/` and `config.json` are gitignored: user state, not source.
- A busy port is not a dead end — `offerToFreePort()` names the process and offers to kill it, but
  **only asks when there is a TTY** (a script-driven run must not kill a process nobody agreed to
  kill).

## Read next

- [HTTP API](EN-HTTP-API) — every endpoint
- [Development & testing](EN-Development) — what is and is not covered by tests, and why
- [How it works](EN-How-It-Works) — the spoofing mechanism in detail
