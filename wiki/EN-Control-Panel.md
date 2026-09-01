# Control panel

[🏠 Home](Home) · [ไทย](TH-Control-Panel) · **English**

---

The panel lives at <http://127.0.0.1:5011> (configurable — see
[Configuration](EN-Configuration)). It is plain HTML/CSS/JS: no framework, no build step.

<p align="center">
  <img src="https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/control-panel.png" alt="Discord Quest Faker control panel" width="820">
</p>

## Top bar

| Element | Meaning |
|---|---|
| Platform badge (`win32` / `darwin` / `linux`) | The OS the tool is running on — it decides which games you can see |
| List status text | `<total games> games · <playable here> for <os> · updated <when>` |
| **Refresh list** | Re-fetch Discord's list right now (same as `--refresh`, without exiting) |

The **yellow banner** at the top is the Terms-of-Service warning. Dismissing it with
*เข้าใจแล้ว / Got it* stores a flag in the browser's `localStorage` so it stays hidden.

## Running panel

Every placeholder currently alive. Each row shows:

- The game icon and name
- The executable being impersonated · `pid <n>` · `auto-stop <N> min` when set
- A **live clock** counting elapsed time
- **Stop** — stops just that executable
- **Stop all** in the panel header — stops everything at once

The page polls the server every **5 seconds**, so anything that happens elsewhere (an auto-stop
firing, someone closing a placeholder window, a CLI start) shows up here on its own.

## Presets panel

Games saved in `config.json` for one-click starts.

| Control | What it does |
|---|---|
| **Start** | Runs the saved executable with the saved auto-stop, if any |
| **Stop** / **Stop all (N)** | Stops every executable of that game |
| **Remove** | Deletes the preset from `config.json` (does not stop a running game) |
| **▸** | Expands the full executable list, so you can run a different one |
| **Not detectable** (disabled) | The preset points at an id no longer in the current list |

Each preset's subtitle reads `config.json · <executable it will start>`, plus its auto-stop.

> A preset stores **exactly one executable**, never `"all"`. Legacy files containing `"all"` are
> rewritten to the first executable at startup, with a line in the terminal saying so.

## Games panel

### Search box

- Matches **game name, application id, aliases, and executable names**
- Accent-folded — `marvel tokon` finds `MARVEL Tōkon`, `pokemon` finds `Pokémon`
- Debounced 180 ms; exact and prefix matches are ranked first
- Pages 100 entries at a time and **loads more as you scroll**, so all ~10,000 games are
  browsable without searching
- The hint below reads `Showing X of Y — scroll for more`

### Auto-stop after ... min

The duration applied to every **Start** pressed in this panel — `0` means run until stopped.
It is seeded from `defaultDurationMinutes` in `config.json`.

### A game row

| Element | Meaning |
|---|---|
| **☆ / ★** | Save / unsave as a preset (written to `config.json` immediately) |
| **✕** | Delete a hand-added game from `custom-games.json` (only on `steam`-tagged rows) |
| **Start** | Runs the first non-launcher executable |
| **Stop** / **Stop all (N)** | Stops every executable of that game |
| **▸** (or clicking the name) | Expands the executable list for per-executable Start/Stop |
| `steam` tag | Added from Steam; not in Discord's detectable list |
| `launcher` tag | A bootstrapper/launcher executable — always sorted last |
| Left accent bar | That game is currently running |

**Start deliberately runs a single executable**: Discord maps the process to one application id
per game, so running several gives no extra progress and only wastes processes. If several do end
up running, the button becomes **Stop all (N)**.

### Add a game from Steam

The `Game missing from Discord's list? Add it from Steam:` box accepts a SteamDB URL, a Steam
store URL, or a bare app id — full details in [Steam games](EN-Steam-Games).

## Read next

- [CLI reference](EN-CLI-Reference) — everything above, without a browser
- [Configuration](EN-Configuration) — presets, port, default auto-stop
- [HTTP API](EN-HTTP-API) — the endpoints this page calls
