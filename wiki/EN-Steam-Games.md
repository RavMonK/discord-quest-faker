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

## Read next

- [CLI reference](EN-CLI-Reference) — `--add-steam`, `--force`, `--exe`
- [Configuration](EN-Configuration) — where `custom-games.json` lives
- [How it works](EN-How-It-Works) — why any executable works
