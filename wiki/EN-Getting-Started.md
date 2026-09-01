# Getting started

[🏠 Home](Home) · [ไทย](TH-Getting-Started) · **English**

---

## 1. Requirements

| You need | Notes |
|---|---|
| **Node.js 18+** | From <https://nodejs.org> (macOS: `brew install node`) |
| **Desktop Discord client** | Must stay open while a placeholder runs — the web client does not detect processes at all |
| **.NET Framework** (Windows) | Provides `csc.exe`. Present on most Windows installs; without it the tool falls back to tiers that own **no window**, which Discord may not detect |

**No `npm install`** — this project has zero external dependencies.

Check Node is available:

```bash
node --version
```

## 2. Let Discord detect games

Two switches inside the desktop client, or the placeholder runs for nothing:

1. **User Settings → Activity Privacy →** enable *"Share your detected activities with others"*
2. **User Settings → Registered Games →** enable *"Display currently running game as a status message"*

## 3. Run it

### Windows

Double-click `start.bat`, or from a terminal:

```bash
node src/index.js
```

### macOS / Linux

```bash
chmod +x start.sh && ./start.sh
```

On launch it:

1. Loads the cached game list first, so the panel is usable immediately — no waiting on the network.
2. **Refreshes the list from Discord in the background**, overwriting `data/games.json` (~10,400 games).
3. Opens the control panel at <http://127.0.0.1:5011>.

If the port is taken, the tool names the process holding it (name + pid) and offers to kill it.
Answer `y` to take the port, or `n` and use `--port 8080` instead.

## 4. Start your first fake game

In the panel:

1. Type a game name into the search box (the list also pages in as you scroll, so you can browse
   all ~10,000 entries without searching).
2. Optionally set **Auto-stop after ... min**.
3. Press **Start**.

**A small window titled with the game name appears** — that is the placeholder process Discord
needs to see.

<p align="center">
  <img src="https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/placeholder-window.png" alt="Overwatch placeholder window" width="440">
</p>

It shows the **game icon**, the executable name being impersonated, the **elapsed time** (ticking
every second), and an **Auto-stop** line with the time remaining (`off` when not set).

> ⚠️ **Do not close that window** — closing it stops that game, exactly like pressing Stop in the
> panel. It is deliberately not respawned.

Within a few seconds Discord should show you playing the game. If it does not, go to
[Troubleshooting & FAQ](EN-Troubleshooting#discord-is-not-showing-the-game).

## 5. Stopping

- Press **Stop** in the panel (or **Stop all** when several are running)
- Or close the placeholder window
- Or press **Ctrl+C** in the terminal — shutting the tool down kills every placeholder it spawned

## Alternative: skip the browser

Start straight from the CLI:

```bash
node src/index.js --start "Overwatch" --duration 60
```

Full flag list: [CLI reference](EN-CLI-Reference).

## Read next

- [Control panel](EN-Control-Panel) — what every control does
- [Configuration](EN-Configuration) — port, presets, default auto-stop
- [How it works](EN-How-It-Works) — why the placeholder needs a real window
