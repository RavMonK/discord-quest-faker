# Configuration (config.json)

[🏠 Home](Home) · [ไทย](TH-Configuration) · **English**

---

`config.json` sits at the repo root and is created on first run. It is gitignored: it is user
state, not source.

```json
{
  "port": 5011,
  "host": "127.0.0.1",
  "openBrowser": true,
  "apiUrl": "https://discord.com/api/v10/applications/detectable",
  "gamesFile": "data/games.json",
  "customGamesFile": "data/custom-games.json",
  "refreshOnStart": true,
  "refreshIntervalMinutes": 720,
  "runtimeDir": "data/runtime",
  "defaultDurationMinutes": 0,
  "maxConcurrent": 12,
  "presets": [
    { "id": "356875221078245376", "name": "Overwatch", "executable": "overwatch.exe", "durationMinutes": 60 }
  ],
  "autoStartPresets": false
}
```

## Keys

| Key | Default | Meaning |
|---|---|---|
| `port` | `5011` | Control panel port (overridable with `--port`) |
| `host` | `127.0.0.1` | Bind address — local-only by default |
| `openBrowser` | `true` | Open a browser on launch (`--headless` disables it) |
| `apiUrl` | Discord's endpoint | Source of the detectable list |
| `gamesFile` | `data/games.json` | Where the game list is cached |
| `customGamesFile` | `data/custom-games.json` | Where hand-added games live |
| `refreshOnStart` | `true` | Refresh the list on every launch (in the background, so startup is not delayed) |
| `refreshIntervalMinutes` | `720` | Re-fetch every N minutes (`0` = never) |
| `runtimeDir` | `data/runtime` | Where placeholders, icons, and build files go |
| `defaultDurationMinutes` | `0` | Default auto-stop (`0` = run until stopped) |
| `maxConcurrent` | `12` | Maximum simultaneous placeholders (counted per executable) |
| `presets` | `[]` | One-click game list |
| `autoStartPresets` | `false` | Start every preset on launch (same as `--presets`) |

All paths are resolved from the repo root.

## Presets

A preset looks like this:

```json
{ "id": "356875221078245376", "name": "Overwatch", "executable": "overwatch.exe", "durationMinutes": 60 }
```

| Field | Accepts |
|---|---|
| `id` | A Discord application id, or `steam:<appid>` for a hand-added game |
| `name` | The label shown in the panel — also used to resolve the game if `id` misses |
| `executable` | A file name (`"lolex.exe"`), an index, an array of names, or `"all"` |
| `durationMinutes` | This preset's auto-stop (`0`/absent = run until stopped) |

- The **★** button saves the executable currently in use.
- **A preset should store exactly one executable**, not `"all"`. If `"all"` is found (written by
  an older version), it is rewritten to the first executable at startup with a line in the
  terminal saying so — running several executables gives no extra progress anyway.
- If `id` is not in the current list, the panel shows a disabled **Not detectable** button.

## File handling rules (the important part)

`src/config.js` encodes two deliberate rules:

1. **A UTF-8 BOM is tolerated.** Windows editors happily save JSON with one, and `JSON.parse`
   rejects it, so the BOM is stripped before parsing.
2. **A file that fails to parse is never overwritten.** With a broken `config.json` the tool runs
   on defaults, prints an error, and **leaves the file alone**. Saving a preset from the panel
   then answers `config.json is not valid JSON - fix it and restart` — otherwise all your
   settings would be lost.

### Flags never leak into the file

`--port` and `--headless` only change the in-memory config. The loader keeps a separate snapshot
of what belongs on disk (`fileState`), so saving a preset from the panel does not write a
temporary port into `config.json`.

### Only some keys are written back

The panel can only ever write these keys:

```
presets  ·  autoStartPresets  ·  defaultDurationMinutes  ·  maxConcurrent
```

Everything else keeps its on-disk value, and the file is written atomically (`.tmp` + rename).

## Files the tool creates

```
data/games.json          Discord's game list (~3 MB, ~10,400 games) — safe to delete, refetched
data/custom-games.json   games added from Steam — never overwritten by a list refresh
data/runtime/            the placeholder binaries — safe to delete while nothing runs
data/runtime/_build/     the C# source and the stamp files that decide on a rebuild
data/runtime/_icons/     downloaded game icons
data/runtime/keepalive.js the script used by the node-tier placeholder
config.json              your settings and presets
```

`data/` and `config.json` are gitignored. Every placeholder is shut down when the tool exits.

## Read next

- [CLI reference](EN-CLI-Reference) — the flags that override these values
- [Control panel](EN-Control-Panel) — the controls that edit this file
- [Architecture](EN-Architecture) — the reasoning behind the rules above
