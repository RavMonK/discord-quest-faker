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

`tests/` uses temporary files, isolated loopback servers and injected persistence. It never
writes the real project config or game cache:

| File | Covers |
|---|---|
| `tests/games.test.js` | `normalize()`, `fold()`, `GameStore` (constructed with a temp-dir config, **never the real `config.json`**) |
| `tests/spoof.test.js` | `materialize()`, `safeName()`, `signalToken()`, `candidates()`/`select()`, `cString()`/`asciiLabel()`, `linuxCompiler()`, the generated Linux source, and `startOne()`'s synchronous guards (already-running, `maxConcurrent`) |
| `tests/steam.test.js` | `parseAppId`, `normalizeExecutable`, `executablesInArguments`, `osKeysFor` |
| `tests/queue.test.js` | `randomBetween`/`clampSeconds`, the list operations, and the whole advance cycle against a stub spoofer (**constructed with its own `save`**, so it never writes the real `config.json`) |

## Security and Linux regression tests

- `tests/server.test.js`: real loopback HTTP requests for Host/Origin/token checks, malformed requests, pagination and queue persistence.
- `tests/security-paths.test.js`: traversal, symlinks, same-size executable tampering, failed replacements and compiled-cache integrity.
- `tests/frontend-api.test.js`: token bootstrap and recovery after server restart, using the actual UI helper.
- `tests/linux.test.js`: real system, Node and compiled placeholders, `/proc/<pid>/exe`, duplicate-start rejection and auto-stop. Skipped outside Linux; the compiled one also needs a compiler and a `DISPLAY`, and asserts the X window through `xwininfo` when it is installed.

Use the latest patch of Node.js 22, 24 or 26 (24 LTS recommended). With Docker running, from the repository root:

```bash
for DQF_NODE in 22 24 26; do
  docker run --rm --network none --user node \
    --mount "type=bind,source=$(pwd),target=/app,readonly" --workdir /app \
    "node:${DQF_NODE}-bookworm-slim" node --test --test-reporter=spec || exit 1
done
```

The source mount is read-only; test data stays in temporary container directories. This verifies Linux process behavior, not Discord quest credit or a desktop GUI. Runtime files must remain writable only by trusted local users; these checks do not sandbox an attacker already running under the same account.

## What it deliberately does not cover (and why)

| Area | Why |
|---|---|
| `config.js` → `load()` / `save()` | Both hardcode the real `config.json` path under the project root; there is no way to point them at a temp file, so testing them would risk clobbering the user's actual config |
| Real timing of the queue's gap | The tests drive it with a `0`-second range; that a 30-70 s wait really is 30-70 s is `randomBetween`'s job, and that is tested directly |
| Windows/macOS GUI placeholders and compilers | Require native OS checks; on Linux both the process tests and the X11 window test run automatically |
| Frontend DOM rendering | The API helper is tested using `node:vm`; rendering still needs a browser |

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

The C# source lives inside `Spoofer.compileWindows()` (`src/spoof.js`). Bump
`PLACEHOLDER_BUILD` when changing generated source. Compiled files are reused only when the
name, build version and SHA-256 match an in-memory record from this process. The first start
after restarting the tool rebuilds the placeholder; disk stamps are not trusted.

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
