# Development & testing

[🏠 Home](Home) · [ไทย](TH-Development) · **English**

---

## Ground rules

- **Never add an npm dependency** — `dependencies` stays empty, runtime *and* dev
  (`npm install` must never be required)
- No linter, no build step, no transpiler
- CommonJS (`require`), not ES modules
- The frontend is a plain browser script: no framework, no bundler

## Commands

```bash
node src/index.js                 # control panel at http://127.0.0.1:5011 + opens a browser
node src/index.js --headless      # same, no browser (use this when driving it from a script)
npm test                          # node's built-in test runner (node:test), zero deps added
node --check src/spoof.js         # syntax check a file
```

## What the test suite covers

`tests/` is **deliberately narrow** — only pure, deterministic logic that is safe to run without
touching real project state:

| File | Covers |
|---|---|
| `tests/games.test.js` | `normalize()`, `fold()`, `GameStore` (constructed with a temp-dir config, **never the real `config.json`**) |
| `tests/spoof.test.js` | `materialize()`, `safeName()`, `signalToken()`, `candidates()`/`select()`, and `startOne()`'s synchronous guards (already-running, `maxConcurrent`) |
| `tests/steam.test.js` | `parseAppId`, `normalizeExecutable`, `executablesInArguments`, `osKeysFor` |
| `tests/queue.test.js` | `randomBetween`/`clampSeconds`, the list operations, and the whole advance cycle against a stub spoofer (**constructed with its own `save`**, so it never writes the real `config.json`) |

## What it deliberately does not cover (and why)

| Area | Why |
|---|---|
| `config.js` → `load()` / `save()` | Both hardcode the real `config.json` path under the project root; there is no way to point them at a temp file, so testing them would risk clobbering the user's actual config |
| Real timing of the queue's gap | The tests drive it with a `0`-second range; that a 30-70 s wait really is 30-70 s is `randomBetween`'s job, and that is tested directly |
| Anything that spawns a real placeholder or invokes `csc.exe` | OS- and environment-dependent — exactly what the manual checks below are for |
| `src/public/` (the frontend) | A plain browser script with no module exports and no DOM in the test process; simulating one would mean adding a dependency like jsdom, which breaks the zero-deps rule |

Behaviour beyond that boundary is **verified against the OS, not through unit tests**.

## The manual checks that matter (Windows)

Is the placeholder really running?

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } | Select-Object ProcessId, Name, ExecutablePath
```

Does it own a window? (non-zero means yes)

```powershell
(Get-Process -Id <pid>).MainWindowHandle
```

What does the file claim to be?

```powershell
(Get-Item <path>).VersionInfo
```

**Kill leftovers between runs** — a crashed server can leave placeholders behind:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Changing the placeholder's C# source

The C# source lives as a string inside `Spoofer.compile()` (`src/spoof.js`). **Bump
`PLACEHOLDER_BUILD` whenever you change it** — otherwise cached placeholders are reused, because
the stamp file is what decides a rebuild (it compares three things: the game name,
`PLACEHOLDER_BUILD`, and the file size).

Anything the window displays must arrive as an **argument**, never be compiled in — otherwise one
build cannot serve every session and the ~800 ms compile comes back on every Start.

## Checklist before changing code

- [ ] No new dependency
- [ ] Read [the 12 invariants](EN-Architecture) — each one was learned by breaking it
- [ ] `npm test` passes
- [ ] Touching `spoof.js`: a real start/stop tested on Windows, with `MainWindowHandle` ≠ 0
- [ ] Touching the C# source: `PLACEHOLDER_BUILD` bumped
- [ ] New endpoint returning presets: it goes through `describePresets()`
- [ ] Cross-platform executables not reintroduced
- [ ] Leftover placeholders cleaned up after testing
- [ ] User-visible behaviour changed: **both wiki languages** updated (plus `README.md` + `README.en.md` if the quick start or the warning changed)

## Editing this wiki

The source files live in the repo's `wiki/` folder and are synced to the GitHub Wiki. Publishing
steps and the link conventions are in
[`wiki/README.md`](https://github.com/RavMonK/discord-quest-faker/blob/main/wiki/README.md).

Adding a page means adding both a `TH-` and an `EN-` file sharing one slug, then linking it from
`Home.md` and `_Sidebar.md` in both languages.

## Read next

- [Architecture](EN-Architecture) — invariants and data flow
- [HTTP API](EN-HTTP-API) — the endpoint contract
- [How it works](EN-How-It-Works) — the reasoning behind the mechanism
