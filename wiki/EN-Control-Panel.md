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

## Queue panel

Games played **one after another**: each entry runs for its own auto-stop time, and when that
time is up the queue waits a **random number of seconds** and starts the next one. The wait is
drawn fresh for every gap, so a run has no fixed rhythm to spot — a queue that always started the
next game exactly 60 s later would be a pattern in itself.

Only one entry ever plays at a time. That is not a limitation: Discord maps a detected process to
a single application id, so a second game running alongside adds nothing.

| Control | What it does |
|---|---|
| **＋** | Adds that game to the end of the queue. It sits in the same place on every list — game rows, executable sub-rows and presets |
| **Gap … – … sec** | The range the wait is drawn from — defaults to `30`–`70`, saved to `config.json` |
| **Start queue** | Runs the queue from the top. Every entry goes back to *waiting* first, so it replays a finished list |
| **Stop queue** | Stops the queue and whatever it is playing. Entries keep the status they reached |
| **Skip** | Moves on now: stops the current game and waits out the usual gap; while already waiting, starts the next entry immediately |
| **Clear** | Empties the queue |
| **… min** on an entry | That entry's auto-stop time — **this is what decides when the queue moves on** |
| **↑ / ↓** | Reorders the entry |
| **✕** | Removes the entry (stops it first if it is the one playing) |

The line above the list says what is happening right now — `Playing <game> — stops after N min,
then a 30–70 s gap`, or `Next up: <game> in 42 s (drawn from 30–70 s)` with a live countdown.

Each entry shows its status: *waiting*, *playing*, *done*, *stopped*, *skipped*, or *failed*
(with the reason, e.g. a game id that is no longer in the list — the queue skips it and carries
on rather than stalling).

> **An entry with `0` min never ends on its own**, so the queue would wait on it forever. New
> entries take the *Auto-stop after* value from the Games panel, so set that before pressing ＋,
> or edit the minutes on the row afterwards. The panel says so on the status line, and the
> terminal prints a warning when it happens.

The queue is stored in `config.json` under `queue`, so it survives a restart —
`node src/index.js --queue` starts it on launch. **Stop all** stops the queue as well, otherwise
it would start the next game a few seconds later and look like the button had not worked.

## Presets panel

Games saved in `config.json` for one-click starts.

| Control | What it does |
|---|---|
| **＋** | Adds the preset to the queue, using the preset's own auto-stop time (disabled when the preset is not detectable) |
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
| **＋** | Add to the queue, with the auto-stop time from the box above |
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
- [Configuration](EN-Configuration) — presets, the queue and its gap, port, default auto-stop
- [HTTP API](EN-HTTP-API) — the endpoints this page calls
