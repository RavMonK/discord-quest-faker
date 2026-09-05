# CLI reference

[🏠 Home](Home) · [ไทย](TH-CLI-Reference) · **English**

---

Everything the panel does is also available from the command line, which is what you want when
driving the tool from a script.

```bash
node src/index.js --help
```

## All flags

| Flag | Meaning |
|---|---|
| *(none)* | Start the control panel and open it in the browser |
| `--headless` | Start the control panel without opening a browser |
| `--port <n>` | Override `port` from `config.json` (never written back to the file) |
| `--refresh` | Just refresh `data/games.json` and exit |
| `--add-steam <id\|url>` | Add a game missing from Discord's list, from its Steam app config |
| `--force` | With `--add-steam`: save the Steam entry even though Discord already has the game |
| `--list [query]` | Print matching games for this OS and exit |
| `--start <name\|id>` | Start a game from the command line (Ctrl+C to stop) |
| `--exe all\|<name>\|<n>` | Which executable(s) to run (default: the first one) |
| `--duration <minutes>` | Stop automatically after N minutes (with `--start`) |
| `--presets` | Start every preset from `config.json` on launch |
| `--queue` | Start the queue from `config.json` on launch — one game at a time, a random gap between each |
| `--help` | Show usage |

Both `--port 8080` and `--port=8080` are accepted.

## Common examples

```bash
node src/index.js --list fortnite            # matching games + the executable index for --exe
node src/index.js --add-steam 3787240        # add a game missing from Discord's list, from Steam
node src/index.js --add-steam 4783780 --force  # save the Steam entry anyway
node src/index.js --start "Rocket League"    # start the first executable (Ctrl+C to stop)
node src/index.js --start "League of Legends" --exe all      # every executable (rarely useful)
node src/index.js --start "World of Warcraft" --exe 2        # pick by index from --list
node src/index.js --start "World of Warcraft" --exe "_retail_/wow.exe"   # pick by name
node src/index.js --start "Overwatch" --duration 60          # stop by itself after 60 minutes
node src/index.js --refresh                  # rewrite data/games.json, then exit
node src/index.js --headless --port 8080     # no browser / different port
node src/index.js --presets                  # start every preset on launch
node src/index.js --queue                    # play the saved queue, one game after another
```

The npm scripts that exist:

```bash
npm start        # = node src/index.js
npm run headless # = node src/index.js --headless
npm run refresh  # = node src/index.js --refresh
npm test         # the test suite (node:test)
```

## `--list` and the index numbers

`--list` prints every executable with the index `--exe` accepts (up to 40 games per run):

```
  League of Legends                             1402418696126992445
      [0] garenalolth/gamedata/apps/lolth/lolex.exe
      [1] league of legends.exe
      [2] garenaloltw/gamedata/apps/loltw/lol.exe
      [3] leagueclientux.exe  (launcher)
```

- Sorted the same way the runner sorts, **launchers last** — so `[0]` is what a plain Start runs.
- Only executables for the **OS you are running on** are shown (see
  [Platform notes](EN-Platform-Notes)).
- The query is optional; `--list` alone lists everything.

## How `--start` resolves a game

`--start` takes an application id or a name, resolved in this order:

1. Exact application id
2. Exact game name (case- and accent-insensitive)
3. Exact alias
4. Exact executable name
5. Game name *containing* the query

So `--start "Overwatch"` and `--start 356875221078245376` are equivalent.

## What `--exe` accepts

| Value | Effect |
|---|---|
| omitted | The first executable (non-launchers first) |
| `all` | Every executable of the game — **rarely what you want**; it does not speed up a quest |
| a file name | e.g. `--exe "cod26-cod.exe"` (exact match, case-insensitive) |
| an index | e.g. `--exe 2` — the number from `--list` |

## Behaviour while `--start` runs

- The process stays alive until the placeholder stops, then prints `[cli] finished.`
- **Ctrl+C** exits and kills every placeholder it spawned (same for SIGTERM/SIGHUP).
- If no game cache exists yet, `--list` and `--start` fetch the list first.

## When the port is busy

The tool names the process holding the port (name + pid) and **offers to kill it**, then retries
`listen()`.

> It only asks when running in a real terminal (`process.stdin.isTTY`). Driven from a script
> (`--headless` in CI, say) nothing is killed that nobody agreed to kill — it prints the pid so
> you can deal with it yourself.

On Windows the kill uses `taskkill /T`, so placeholders spawned by a leftover panel — its
children — go with it.

## Read next

- [Configuration](EN-Configuration) — the values these flags override
- [Steam games](EN-Steam-Games) — `--add-steam` and `--force` in detail
- [Control panel](EN-Control-Panel) — the UI equivalent
