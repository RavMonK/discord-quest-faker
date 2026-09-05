# HTTP API

[🏠 Home](Home) · [ไทย](TH-HTTP-API) · **English**

---

The control panel talks to the server through a JSON API under `/api/`. Every other `GET` serves
a static file from `src/public/`.

**Base URL** `http://127.0.0.1:5011` (follows `host`/`port`)

The panel accepts loopback connections only (`127.0.0.1`, `localhost`, or `::1`). Host, Origin and Fetch Metadata checks block cross-site requests. Every API request except `GET /api/session` requires an `X-DQF-Token` header. The UI obtains the token automatically. The token changes on restart and is not written to disk. This protects against websites; other programs running locally can obtain a session, so it is not a login system.

`GET /api/session` returns `{ "token": "..." }` with `Cache-Control: no-store`. POST/PATCH/DELETE requests must send `Content-Type: application/json`, even for an empty body. Invalid tokens or origins return 403, malformed URLs/Hosts return 400, and incorrect content types return 415. `limit` must be an integer from 1 to 500; `offset` must be a non-negative safe integer; invalid pagination returns 400.

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
  "queue": { "running": true, "currentUid": "q1", "currentKey": "356875221078245376::overwatch.exe",
             "nextUid": "q2", "nextStartAt": 1756728100000,
             "delay": { "min": 30, "max": 70 }, "defaultDurationMinutes": 0,
             "items": [ { "uid": "q1", "id": "356875221078245376", "name": "Overwatch",
                          "icon": "...", "iconUrl": null, "executable": "overwatch.exe",
                          "durationMinutes": 20, "effectiveDurationMinutes": 20,
                          "status": "running", "reason": null,
                          "startedAt": 1756728000000, "missing": false } ] },
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

No body → `{ ok: true, stopped: <count>, running: [], queue: {...} }`

It stops the **queue** as well: leaving it running would start the next game a few seconds later
and make the button look broken.

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

## The queue endpoints

The queue plays one entry at a time and starts the next after a random gap. **Every one of these
answers with the whole queue** (`{ queue: {...} }`), in the shape `/api/state` shows above, so
the panel never has to re-read the state after a change.

`uid` is a runtime handle (`q1`, `q2`, …) and is **not stable across restarts** — the entries
persisted in `config.json` get fresh ones each launch. Address entries by the `uid` in the
current response.

`status` is one of `pending` · `running` · `done` · `stopped` · `skipped` · `failed`
(`reason` carries the detail on a failure). `nextStartAt` is an epoch-ms timestamp: the moment
the next entry starts, which is what the panel counts down to.

### `POST /api/queue`

```json
{ "id": "356875221078245376", "executable": "overwatch.exe", "durationMinutes": 20 }
```

Appends one entry. `executable` accepts a name or an index and always resolves to a **single**
executable; `durationMinutes` is what decides when the queue moves on (`0` falls back to
`defaultDurationMinutes`, and if that is `0` too the queue waits on the entry).

`200` → `{ ok: true, item, queue }` · `404` → game not found

### `PATCH /api/queue`

```json
{ "uid": "q2", "durationMinutes": 25 }
```

Edits one entry (`durationMinutes`, `executable`). `200` → `{ ok: true, queue }` · `404` → no
such entry

### `DELETE /api/queue`

```json
{ "uid": "q2" }     // remove one entry (stops it first if it is playing)
{ "all": true }     // stop the queue and empty it
```

`200` → `{ ok: true, queue, running }` · `404` → no such entry

### `POST /api/queue/move`

```json
{ "uid": "q2", "direction": "up" }
```

`direction` is `"up"` or `"down"`. Moving past either end is a no-op that still answers `200`.

### `POST /api/queue/start`

No body. Sets every entry back to `pending` and starts the first one, so a finished queue replays
instead of doing nothing.

`200` → `{ ok: true, queue, running }` · `409` → already running, or the queue is empty

### `POST /api/queue/stop`

No body. Stops the queue and the game it is playing. Always `200` — `ok` is `false` when the
queue was not running. `POST /api/stop-all` stops the queue too.

### `POST /api/queue/skip`

No body. While a game is playing: stops it and waits out the usual random gap. While already
waiting: starts the next entry immediately.

`200` → `{ ok: true, queue, running }` · `409` → the queue is not running

### `POST /api/queue/settings`

```json
{ "minSeconds": 30, "maxSeconds": 70 }
```

Sets the gap range and saves it to `config.json`. Values are clamped to `0`–`3600` and a reversed
pair is swapped rather than refused. `200` → `{ ok: true, delay: { min, max }, queue }`

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
DQF_TOKEN=$(curl -fsS http://127.0.0.1:5011/api/session | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')

curl -H "X-DQF-Token: $DQF_TOKEN" http://127.0.0.1:5011/api/state
curl -H "X-DQF-Token: $DQF_TOKEN" "http://127.0.0.1:5011/api/games?q=overwatch&limit=5"
curl -H "X-DQF-Token: $DQF_TOKEN" -X POST http://127.0.0.1:5011/api/start -H "Content-Type: application/json" -d '{"id":"356875221078245376"}'
curl -H "X-DQF-Token: $DQF_TOKEN" -X POST http://127.0.0.1:5011/api/stop-all -H "Content-Type: application/json"
curl -H "X-DQF-Token: $DQF_TOKEN" -X POST http://127.0.0.1:5011/api/queue -H "Content-Type: application/json" -d '{"id":"356875221078245376","durationMinutes":20}'
curl -H "X-DQF-Token: $DQF_TOKEN" -X POST http://127.0.0.1:5011/api/queue/start -H "Content-Type: application/json"
```

## Read next

- [Architecture](EN-Architecture) — the modules behind these endpoints
- [Control panel](EN-Control-Panel) — which control calls which endpoint
- [CLI reference](EN-CLI-Reference) — the non-HTTP path to the same behaviour
