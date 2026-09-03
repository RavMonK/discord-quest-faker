# How it works

[🏠 Home](Home) · [ไทย](TH-How-It-Works) · **English**

---

## How Discord detects games

The desktop client walks the **executable path of every running process** and matches it against
the `executables` entries of its own detectable list. For example:

| Game | Executable in the list |
|---|---|
| Overwatch | `overwatch.exe` |
| League of Legends | `garenalolth/gamedata/apps/lolth/lolex.exe` |
| World of Warcraft | `_retail_/wow-64.exe` |

When a process path ends with one of those entries, Discord maps it to that game's
**application id**, shows the "playing" status, and quest progress follows.

So all this tool does is create a file with **exactly that name and directory structure** and
keep it running.

## The three-tier fallback chain

`Spoofer.tiers()` tries each tier in order of how convincing it is, dropping to the next one
automatically when a tier is unusable:

| Order | Tier | Platform | How the file is made | Size | RAM | Window |
|---|---|---|---|---|---|---|
| 1 | `compiled` | Windows | A real exe compiled with `csc.exe` | 5 KB | ~20 MB | ✅ yes |
| 1 | `compiled` | macOS | A real Cocoa app compiled with `clang` | ~56 KB | ~25 MB | ✅ yes |
| 2 | `system` | Windows | A copy of `System32\waitfor.exe` | 64 KB | ~6 MB | ❌ no |
| 2 | `system` | Linux only | A copy of `/bin/sleep` | ~150 KB | ~2 MB | ❌ no |
| 3 | `node` | any | A copy of the running `node` binary + `keepalive.js` | ~90 MB | ~35 MB | ❌ no |

**macOS has no `system` tier.** It always SIGKILLs a copy of one of Apple's own binaries placed
anywhere else (a launch constraint), so the chain there is `compiled` → `node`. The macOS
`compiled` tier needs the Xcode Command Line Tools (`clang` + the Cocoa SDK); without them it
falls through to the windowless `node` tier. See [Platform notes](EN-Platform-Notes) for details.

Two things move a session down a tier: a tier that throws, or whose process dies within 2
seconds, counts as unusable and the next one is tried immediately; and a tier whose process is
killed abnormally 3 times counts as not working on this machine, so it is abandoned too. The
second rule exists because some systems take far longer than 2 seconds to kill the placeholder.

## The single most important constraint: a real window

**Discord does not only look at process names — it looks for a process that owns a visible
window.** A silent, windowless process is never detected, even when the file name matches exactly.

The tier-1 placeholder therefore opens a **real WinForms window with a running message loop**,
titled with the game name, and is spawned with `windowsHide: false`. This mirrors
[discord-quest-completer](https://github.com/markterence/discord-quest-completer), which uses
`CreateWindowExW` + `ShowWindow(hWnd, SW_SHOWNORMAL)` + a message loop via WinAPI.

<p align="center">
  <img src="https://raw.githubusercontent.com/RavMonK/discord-quest-faker/main/docs/screenshots/placeholder-window.png" alt="Overwatch placeholder window" width="440">
</p>

> **Closing the window stops that game**, exactly like pressing Stop in the panel. It is
> deliberately never respawned.

⚠️ Tiers 2 and 3 own **no window**, so Discord very likely will not pick them up. When the tool
falls back to them it prints a warning in the terminal. The fix is installing the .NET Framework
so `csc.exe` is available.

## Why not just copy a system binary

Beyond the window problem, a copied binary **carries its original identity inside it**. A copy of
`waitfor.exe` renamed to `wwm.exe` still tells Windows it is
*"waitfor - wait/send a signal over a network" by Microsoft Corporation*.

A real consequence: Task Manager's Processes tab shows the name the *file* declares, so searching
for `wwm` finds nothing while the process is plainly running. You have to search the **Details**
tab by file name instead.

The compiled placeholder fixes that: the game name is embedded in its assembly attributes and it
is compiled straight to its final path, so `FileDescription`, `ProductName`, and
`OriginalFilename` all match the game and its real executable name.

Verify it yourself:

```powershell
(Get-Item <path to the placeholder>).VersionInfo
```

## The whole path tail must match, not just the basename

Entries like `_retail_/wow-64.exe` or `garenalolth/gamedata/apps/lolth/lolex.exe` need their
directory prefix recreated under `data/runtime/<game id>/`:

```
data/runtime/356875221078245376/overwatch.exe
data/runtime/1402418696126992445/garenalolth/gamedata/apps/lolth/lolex.exe
```

macOS entries ending in `.app` get a minimal app bundle, so the process path ends with
`Foo.app/Contents/MacOS/Foo` just like the real game.

## How the window knows what to display

Everything the window shows — the game icon, elapsed time, and time left before auto-stop —
arrives as **command line arguments**, never compiled in:

```
<placeholder> --icon <path|-> --started <epoch ms> --duration <minutes>
```

That way **one build serves every session** and no recompile is needed per Start. The first
compile takes ~0.8 s and is then cached; a stamp file holding the game name,
`PLACEHOLDER_BUILD`, and the file size decides whether a rebuild is needed.

The icon is downloaded from Discord's / Steam's CDN **in the background**, with the path returned
immediately. The window polls for that file once a second for ~90 s and otherwise shows the
game's initial — **pressing Start must never wait on a CDN.** Downloaded icons are cached in
`data/runtime/_icons/`.

## Restart policy (deliberately per-tier)

| Tier | The process ends when | What the tool does |
|---|---|---|
| `compiled` | the user closes the window | **No restart** — that counts as a stop |
| `system` | `waitfor` times out (caps at 99999 s) / `sleep` elapses | **Respawns**, so the session lasts until stopped |
| `node` | it does not end on its own (but if it does) | **Respawns** |

Restarts are capped at 500 (`MAX_RESTARTS`) so a permanently broken placeholder cannot spin forever.

## Inherent limitations

- Discord maps a detected process to **one** application id per game, so running several
  executables of the same game gives **no extra quest progress**. The panel deliberately starts
  a single one.
- **Any executable from the list works** — there is no "correct" one. Both `cod.exe` and
  `cod26-cod.exe` get Modern Warfare 4 detected.
- A game **absent from the detectable list** cannot be faked for quests (see
  [Steam games](EN-Steam-Games) for what is and is not possible there).

## Read next

- [Architecture](EN-Architecture) — module responsibilities and the invariants
- [Platform notes](EN-Platform-Notes) — why macOS can do far less
- [Troubleshooting & FAQ](EN-Troubleshooting) — confirming the process is really running
