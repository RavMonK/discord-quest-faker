# Adding Steam games

[🏠 Home](Home) · [ไทย](TH-Steam-Games) · **English**

---

A game missing from Discord's detectable list can still be added by hand, by reading its
executable names out of **Steam's launch config**.

## How to add one

### From the panel

The **"Game missing from Discord's list? Add it from Steam:"** box under the game list accepts:

```
https://steamdb.info/app/3787240/config/     → MARVEL Tōkon: Fighting Souls (6 executables)
https://store.steampowered.com/app/570/      → Dota 2
4783780                                       → a bare app id works too
```

`steamcommunity.com/app/<id>`, `steam://` links, and URLs carrying `?appid=` are also accepted.

### From the CLI

```bash
node src/index.js --add-steam 3787240
node src/index.js --add-steam https://steamdb.info/app/3787240/config/
```

Hand-added games get a `steam` tag, live in `data/custom-games.json` (**they survive a list
refresh**), and can be deleted with the **✕** button.

> **Note:** SteamDB itself blocks automated requests (Cloudflare 403), so the lookup goes through
> `api.steamcmd.net` — the same appinfo data SteamDB's config page renders.

## ⚠️ The limitation to understand first

**Discord's quests are tied to application ids in Discord's own detectable list.** A game added
from Steam earns **no quest progress**, because Discord does not know that id.

What it does give you is the **"playing" status**: start the placeholder, then add it under
**Settings → Registered Games → Add it!** while the process is running.

## When Discord already has the game

The tool **refuses to create a duplicate entry** and points you at Discord's entry instead, with
an explanation. That is not an error — it is the correct outcome, since only Discord's own entry
earns quest progress.

In the panel the note appears under the box with an **Add anyway** button, if you really do want
the Steam entry. From the CLI, pass `--force`.

The matcher (`findDetectableTwin()`) scores candidates three ways:

| Score | Condition |
|---|---|
| 3 | Titles match after stripping suffixes like `beta`, `demo`, `playtest`, `early access` |
| 2 | At least one executable name is shared |
| 1 | One title contains the other (needs ≥ 8 characters) |

On a tie the longer title wins, so `"... modern warfare 4"` beats a shorter loose match.

## Steam's executable names need not match Discord's

A real case: `https://steamdb.info/app/4783780/config/` (CoD MW4 Beta)

| Source | Executable |
|---|---|
| Steam — `executable` field | `bootstrapper.exe` |
| Steam — `arguments` field | `cod26-cod.exe` |
| Discord's detectable list | `cod.exe`, `sp26-cod.exe`, `cod26-cod.exe` |

`bootstrapper.exe` only launches the game; the real binary is named in the **Arguments** field of
the config page. The tool therefore reads **both fields**, and always sorts
bootstrappers/launchers last:

```
   [0] cod26-cod.exe
   [1] bootstrapper.exe  (launcher)
```

On Discord's side, **any executable from the list works** — both `cod.exe` and `cod26-cod.exe`
get detected, since both map to the same application id. The one that does *not* work is
`bootstrapper.exe`, which is not in Discord's list at all.

So the check runs on every add and reports like this:

```
[steam] "Call of Duty®: Modern Warfare® 4 - Beta" is already in Discord's list
        as "Call of Duty: Modern Warfare 4"
        Steam lists:   bootstrapper.exe
        Discord wants: cod.exe, sp26-cod.exe, cod26-cod.exe
   [0] cod.exe
   [1] sp26-cod.exe
   [2] cod26-cod.exe
```

Then pick one yourself:

```bash
node src/index.js --start "Call of Duty: Modern Warfare 4" --exe "cod26-cod.exe"
```

In the panel, press **▸** and Start `cod26-cod.exe`.

## What is read from Steam

`src/steam.js` reshapes Steam appinfo into the same shape a Discord entry has, so the rest of the
program cannot tell them apart:

```json
{
  "id": "steam:3787240",
  "appId": "3787240",
  "name": "MARVEL Tōkon: Fighting Souls",
  "iconUrl": "https://cdn.cloudflare.steamstatic.com/...",
  "custom": true,
  "source": "steam",
  "executables": [{ "name": "...", "os": "win32", "isLauncher": false }]
}
```

Details worth knowing:

- **The OS** comes from the launch entry's `oslist`. Steam often leaves it empty, so the file
  extension decides: `.exe` → win32, `.app` → darwin, `.sh` / `.x86_64` → linux.
- **The arguments field** is scanned for tokens ending in `.exe`/`.app`/`.sh`/`.bat`/`.x86_64`,
  **with switches filtered out** — Counter-Strike 2's data really does contain `-steam.exe`.
- **Paths are sanitised** — backslashes to slashes, leading `./` and `/` dropped, entries
  containing `..` rejected outright.
- Names starting with `start_protected_game`, `bootstrapper`, or `launcher` are marked as
  launchers and sorted last.
- An app with no launch executable produces an error rather than an empty entry.
- **Launcher URIs are not executables.** Some games hand off to another launcher, so Steam's
  `executable` is a URI rather than a file — EA SPORTS FC 27 has
  `steam2ea://launchgame/4080220?...`. Anything shaped `scheme://...` is dropped, and an app
  whose launch config holds nothing else is refused with an error naming the launcher. Steam
  simply does not know the real process name for these games: wait for Discord's own entry to
  list one, then `--refresh` — or type the process path yourself (below).

## Adding a game by its process path

When Steam has nothing usable — EA SPORTS FC 27 is the case above — type the path the game's
process runs from instead. In the panel it is the **"…or type the game's process path
yourself:"** row under the Steam box; from the CLI:

```bash
node src/index.js --add-exe "EA SPORTS FC 27\FC27.exe"
node src/index.js --add-exe "FC27.exe" --name "EA SPORTS FC 27"
```

- **Type the folder too when you know it.** Discord matches the *tail* of a process path, and its
  entries for this series include the folder (`ea sports fc 26/fc26.exe`), so a bare `FC27.exe`
  will likely not match once Discord lists the game. The folder is recreated under
  `data/runtime/custom-<name>/`, exactly like a Discord entry's.
- **A full path works** — `C:\Games\EA SPORTS FC 27\FC27.exe` copied out of Task Manager loses its
  drive letter and keeps the rest, which still ends with the right tail.
- **Use Discord's game id when it has one.** On the game's profile in Discord, **⋯ → Copy Game
  ID**, then lead the path with it — `1531874756096295054\EA SPORTS FC 27\FC27.exe` — or put it
  in the name box / `--id`. The entry then sits on Discord's application id, and its name and
  icon come from Discord (`/applications/<id>/rpc`, no login needed). Discord can know a game —
  even run a quest for it — before its detectable entry lists any executable: EA Sports FC 27
  did, and while it lists none **nothing this tool does gets it detected** (a Steam
  `SteamAppId` in the placeholder's environment was tried; Discord ignores it). Once Discord's
  entry lists an executable, new adds are pointed at it, and a saved entry on the same id simply
  adds its paths to Discord's instead of hiding them — so leaving it in place is harmless.
- **The name** defaults to the folder the executable sits in (`EA SPORTS FC 27`), or the file
  name without `.exe`. Adding another path under the same name adds a second executable to that
  game instead of making a new one.
- **Refused:** `..`, the characters Windows forbids (`< > : " | ? *`), a name not ending in
  `.exe` on Windows, and one ending in `.exe` on macOS/Linux — a real game there is never a
  `foo.exe` process.
- **Discord already has it?** When the path is — or is the tail of — an executable in Discord's
  list (`FC26.exe` → *EA Sports FC 26*), the tool points you at that entry, same as a Steam add.
  **Add anyway** / `--force` saves yours regardless.

Such a game gets a `custom` tag and lives in `data/custom-games.json` next to the Steam ones.
The limitation above applies unchanged: the entry itself earns nothing. It pays off when the path
you typed is the one in **Discord's** list — Discord matches the running process against its own
list, not against this tool's ids — for example a game Discord has added since
`data/games.json` was fetched.

## Read next

- [CLI reference](EN-CLI-Reference) — `--add-steam`, `--add-exe`, `--force`, `--exe`
- [Configuration](EN-Configuration) — where `custom-games.json` lives
- [How it works](EN-How-It-Works) — why any executable works
