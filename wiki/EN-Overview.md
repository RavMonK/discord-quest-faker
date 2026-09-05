# Project overview

[🏠 Home](Home) · [ไทย](TH-Overview) · **English**

---

## What this is

**Discord Quest Faker** is a tool that runs entirely on your own machine and does two things:

1. **Fetches Discord's detectable-game list** from
   `https://discord.com/api/v10/applications/detectable` (~10,400 games) and caches it as JSON.
2. **Spawns placeholder processes** whose file name and path match one of that game's
   executables, so Discord's game detection reports the game as running and *"play game X for
   Y minutes"* quests progress.

Everything is driven from a local control panel at <http://127.0.0.1:5011>, or from the CLI.

<p align="center">
  <img src="https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/control-panel.png" alt="Discord Quest Faker control panel" width="820">
</p>

## Know this before you start

- ⚠️ **This violates Discord's Terms of Service.** Quests can be voided, rewards revoked, and
  accounts limited. Read [Disclaimer & risks](EN-Disclaimer) in full first.
- Only **"play a game"** quests work. Quests that require **streaming to a friend** or
  **watching a video** are detected differently and cannot be faked this way.
- The **desktop Discord client** must be running — the web version does not detect processes.
- No Discord token, password, or account data is ever read, used, or transmitted. The tool only
  starts local processes on your machine.

## Features

| Thing | Detail |
|---|---|
| Zero dependencies | Pure Node.js — `npm install` is never needed |
| Web control panel | Search, Start/Stop, presets, auto-stop, add games from Steam |
| Placeholder owns a real window | A 5 KB exe compiled with `csc.exe`, showing the game icon and elapsed time |
| Three-tier fallback chain | If a tier is unavailable, the next one is used automatically |
| Presets | Press **★** to save a game into `config.json` for one-click starts |
| Queue | Line games up with **＋**: each plays for its own time, then the next starts after a random 30-70 s gap |
| Auto-stop | Stop by itself after N minutes |
| Games missing from the list | Add them from a Steam app id / SteamDB URL |
| Cross-platform | Windows (full), macOS / Linux (limited — see [Platform notes](EN-Platform-Notes)) |
| CLI | Start, search, and refresh without opening a browser |

## Requirements

- **Node.js 18+**
- The **desktop Discord client**, running
- On Windows: the **.NET Framework** (present on virtually every machine) so `csc.exe` exists

Step-by-step in [Getting started](EN-Getting-Started).

## Repository layout

```
src/index.js        entry point + CLI modes
src/config.js       reads/writes config.json
src/games.js        fetches Discord's list, caches, searches, merges custom games
src/steam.js        resolves a Steam app id to the same game shape
src/spoof.js        creates and runs the placeholder processes
src/server.js       HTTP API behind the control panel
src/public/         the control panel (plain HTML/CSS/JS, no framework)
tests/              test suite (node:test)
data/               game cache + placeholder binaries (gitignored)
config.json         your settings, presets and queue (gitignored)
```

What each module is responsible for: [Architecture](EN-Architecture).

## Read next

- [Getting started](EN-Getting-Started) — install and first run
- [How it works](EN-How-It-Works) — how Discord detects games, and how this fools it
- [Troubleshooting & FAQ](EN-Troubleshooting) — Discord is not showing the game, now what

## License

[MIT](https://github.com/RavMonK/discord-quest-faker/blob/main/LICENSE) © 2026 RavMonK

The windowed-placeholder approach follows
[markterence/discord-quest-completer](https://github.com/markterence/discord-quest-completer).
