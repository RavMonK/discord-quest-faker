# HTTP API

[🏠 Home](Home) · [ไทย](TH-HTTP-API) · **English**

---

The control panel talks to the server through a JSON API under `/api/`. Every other `GET` serves
a static file from `src/public/`.

**Base URL** `http://127.0.0.1:5011` (follows `host`/`port`)

> ⚠️ **The API has no authentication**, which is why it binds to `127.0.0.1` by default. Anyone
> who can reach it can start and stop processes on this machine — think before changing `host`.

Shared details:

- Request bodies must be JSON and at most **1 MB**
- All responses are JSON with `Cache-Control: no-store`
- Errors answer `{ ok: false, reason: "..." }`
- Unknown routes answer `404 { ok: false, reason: "unknown endpoint" }`

## `GET /api/state`

Everything the panel needs. It polls this every 5 seconds.

```json
{
  "os": "win32",
  "platform": "win32",
  "games": { "count": 10500, "custom": 1, "playableHere": 10447,
             "fetchedAt": "2026-09-01T12:00:00.000Z", "source": "api",
             "refreshing": false, "lastError": null, "file": "data/games.json" },
  "running": [ { "key": "356875221078245376::overwatch.exe", "id": "356875221078245376",
                 "gameId": "356875221078245376", "name": "Overwatch", "icon": "...",
                 "executable": "overwatch.exe", "path": "C:\\...\\overwatch.exe",
                 "pid": 12345, "startedAt": 1756728000000, "elapsedSeconds": 42,
                 "durationMinutes": 60, "restarts": 0, "placeholder": "compiled" } ],
  "presets": [ { "id": "...", "name": "Overwatch", "executable": "overwatch.exe",
                 "executables": [ { "name": "overwatch.exe", "os": "win32", "isLauncher": false } ],
                 "durationMinutes": 60, "icon": "...", "iconUrl": null,
                 "custom": false, "missing": false } ],
  "settings": { "defaultDurationMinutes": 0, "maxConcurrent": 12,
                "refreshIntervalMinutes": 720, "configFile": "config.json" }
}
```

`placeholder` names the tier in use (`compiled` / `system` / `node`). Anything other than
`compiled` means **no window**, so Discord may not detect it.

## `GET /api/games`

| Query | Default | Meaning |
|---|---|---|
| `q` | `""` | Search term (name, id, aliases, executable names — accent-folded) |
| `limit` | `100` | Page size (capped at `500`) |
| `offset` | `0` | How many entries to skip |
| `all` | — | `all=1` returns every OS's games, not just this one's |

```json
{ "total": 37, "offset": 0,
  "items": [ { "id": "...", "name": "...", "icon": "...", "iconUrl": null,
               "custom": false, "source": "discord",
               "executables": [ { "name": "...", "os": "win32", "isLauncher": false } ] } ] }
```

`executables` uses the same order the runner uses (launchers last), so `executables[0]` is what a
plain Start runs.

## `POST /api/start`

```json
{ "id": "356875221078245376", "executable": "overwatch.exe", "durationMinutes": 60 }
```

| Field | Accepts |
|---|---|
| `id` or `name` | An application id or a game name (loose resolution) |
| `executable` | omitted = the first · `"all"` · a file name · an array of names · an index |
| `durationMinutes` | Auto-stop (omitted = `defaultDurationMinutes`) |

- `200` → `{ ok: true, sessions: [...], results: [...], running: [...] }`
- `404` → game not found
- `409` → nothing could start (already running / over `maxConcurrent` / no executable for this
  OS) — per-executable reasons are in `results`

## `POST /api/stop`

```json
{ "key": "356875221078245376::overwatch.exe" }   // stop one executable
{ "id": "356875221078245376" }                    // stop every executable of that game
```

`200` → `{ ok: true, running: [...] }` · `404` → not running

## `POST /api/stop-all`

No body → `{ ok: true, stopped: <count>, running: [] }`

## `POST /api/refresh`

Re-fetch Discord's list right now.

- `200` → `{ ok: true, count, fetchedAt, games }`
- `502` → `{ ok: false, reason, games }` (the cached list stays usable)

## `POST /api/custom`

```json
{ "input": "https://steamdb.info/app/3787240/config/", "force": false }
```

- **Added** → `{ ok: true, added: true, game, note, games }`
- **Discord already tracks it** (and `force` was not sent) →
  `{ ok: true, added: false, useInstead: { id, name, executables }, note, games }`
  — not an error; the panel opens Discord's entry instead (see [Steam games](EN-Steam-Games))
- `400` → no app id found / Steam lookup failed / no launch executable

## `DELETE /api/custom`

```json
{ "id": "steam:3787240" }
```

Stops that game's processes first, then removes it from `custom-games.json`.
`200` → `{ ok: true, games, running }` · `404` → not a custom game

## `POST /api/presets`

```json
{ "id": "356875221078245376", "executable": "overwatch.exe", "durationMinutes": 60 }
```

Appends a preset to `config.json` (an id already present is a no-op that still answers `200`).

- `200` → `{ ok: true, presets: [...] }`
- `404` → game not found
- `500` → `config.json` could not be parsed, so nothing was saved (the file is left untouched)

## `DELETE /api/presets`

```json
{ "id": "356875221078245376" }
```

`200` → `{ ok: true, presets: [...] }` · `500` → could not write the file (same reason as above)

## curl examples

```bash
curl http://127.0.0.1:5011/api/state
curl "http://127.0.0.1:5011/api/games?q=overwatch&limit=5"
curl -X POST http://127.0.0.1:5011/api/start -H "Content-Type: application/json" -d '{"id":"356875221078245376"}'
curl -X POST http://127.0.0.1:5011/api/stop-all
```

## Read next

- [Architecture](EN-Architecture) — the modules behind these endpoints
- [Control panel](EN-Control-Panel) — which control calls which endpoint
- [CLI reference](EN-CLI-Reference) — the non-HTTP path to the same behaviour
