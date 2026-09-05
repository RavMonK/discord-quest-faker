# Troubleshooting & FAQ

[🏠 Home](Home) · [ไทย](TH-Troubleshooting) · **English**

---

## Common problems

| Symptom | Fix |
|---|---|
| `node : command not found` | Node.js is not installed, or the terminal was not reopened after installing |
| `port 5011 is already in use` | The tool names the process holding it (name + pid) and offers to kill it — answer `y` to take the port, or `n` and change `port` in `config.json` / run with `--port 8080` |
| Cannot find the process in Task Manager | Search the **Details** tab by file name — the Processes tab searches the name the *file declares*, not the file name |
| `config.json is not valid JSON` | A typo in the file. It is never overwritten; fix it and restart |
| A game is not in the list | Press **Refresh list**, or run `node src/index.js --refresh` |
| `csc.exe (.NET Framework) not found` | Install the .NET Framework — otherwise you get a windowless placeholder, which usually is not detected |
| `limit reached (maxConcurrent = 12)` | Stop something, or raise `maxConcurrent` in `config.json` |
| `<game> has no win32 executable in the detectable list` | That game has no executable for this OS (see [Platform notes](EN-Platform-Notes)) |

## Discord is not showing the game

Work through this in order:

1. **Confirm the process really is running** — Task Manager's **Details** tab (not Processes),
   searching by file name such as `wwm.exe`, or:

   ```bash
   tasklist /FI "IMAGENAME eq wwm.exe"
   ```

2. **Enable game detection** — Settings → **Registered Games** → turn on
   *"Display currently running game as a status message"*
3. **Enable activity sharing** — Settings → **Activity Privacy** → turn on
   *"Share your detected activities with others"*
4. **Use the desktop client** (the web version cannot detect processes at all)
5. Still nothing? **Restart Discord** while the placeholder keeps running.
6. **Test whether Discord can see the process at all** — Settings → Registered Games →
   **"Add it!"** and check whether the game appears in the process list Discord offers.
   - **It appears** → Discord sees the process; the problem is matching or settings.
   - **It does not** → Discord is not scanning it. Check whether the placeholder **owns a
     window**:

     ```powershell
     (Get-Process -Id <pid>).MainWindowHandle
     ```

     `0` means no window, so a fallback tier is in use — look for the
     `the ... placeholder has no window` warning in the terminal and install the .NET Framework.

## Reading the terminal log

| Line | Meaning |
|---|---|
| `[spoof] started "<game>" as <exe> (pid N, compiled placeholder)` | Running on the best tier (windowed) |
| `[spoof] ... the <tier> placeholder has no window` | ⚠️ Fell back to a windowless tier; Discord may not detect it |
| `[spoof] ... window closed - session ended` | The user closed the window — treated as a stop, never respawned |
| `[spoof] ... placeholder crashed unexpectedly (code=N)` | The placeholder died on its own, not by a user closing it |
| `[spoof] ... placeholder ended after Ns - restarting (#N)` | A `system`/`node` placeholder timed out and was respawned (normal) |
| `[games] refresh failed: ... - keeping cached list` | The refresh failed but the cached list is still usable |
| `[config] preset "X": "all" -> <exe>` | A legacy `"all"` preset was rewritten to a single executable |

## FAQ

**Can this complete streaming or video quests?**
No. It only fakes "a game process is running". Streaming-to-a-friend and watch-a-video quests are
detected differently.

**Does Discord have to stay open?**
Yes. With Discord closed, nothing observes the placeholder.

**Can I run several games at once?**
Yes, up to `maxConcurrent` (default 12, counted per executable). Discord will show one game as
your playing status.

**Does running several executables of one game speed a quest up?**
No. Discord maps the process to one application id per game — which is why the panel starts a
single one.

**Which executable should I pick?**
Any of the ones in Discord's list. Both `cod.exe` and `cod26-cod.exe` get Modern Warfare 4
detected; there is no "correct" one.

**If I close the placeholder window, will it come back?**
No. Closing the window is a stop. (Unlike the `system`/`node` tiers, which time out and are
respawned.)

**Can I delete `data/`?**
Yes, while nothing is running — the list is refetched and placeholders are rebuilt. Note that
deleting `data/custom-games.json` also removes hand-added games.

**Does this touch my Discord token or account?**
No. No credentials are read, used, or transmitted. It starts local processes and makes one HTTP
GET to Discord's public game-list endpoint.

**Do Steam-added games earn quest progress?**
No — the reasoning is in [Steam games](EN-Steam-Games).

**Placeholders are left over after a crash. Now what?**
Clean them up with the commands in [Platform notes](EN-Platform-Notes), or restart the tool and
answer `y` when it offers to kill the process holding the port (`taskkill /T` takes the children
with it).

**Can I open the panel from another machine on my network?**
No. The panel now accepts loopback connections only. Use `127.0.0.1`, `localhost`, or `::1`
for `host`. API scripts must obtain a session token and send it as `X-DQF-Token`; see [HTTP API](EN-HTTP-API).

## Read next

- [How it works](EN-How-It-Works) — why the window matters most
- [Platform notes](EN-Platform-Notes) — the verification commands
- [Configuration](EN-Configuration) — `maxConcurrent`, port, auto-stop
