# Platform notes

[🏠 Home](Home) · [ไทย](TH-Platform-Notes) · **English**

---

## The short version

| OS | Games with an executable | Placeholder owns a window | Status |
|---|---|---|---|
| **Windows** | 10,447 | ✅ yes (`compiled` tier) | Fully working, tested |
| **macOS** | **62** | ❌ no (`/bin/sleep`) | Very limited, untested on real hardware |
| **Linux** | 8 | ❌ no (`/bin/sleep`) | Very limited, untested on real hardware |

The tool only lists games that have an executable **for the OS it is running on**. A Mac
therefore sees just those 62 games, and a Windows-only game (MARVEL Tōkon, say) never appears.

## Windows

Everything works as designed:

- The `compiled` tier builds a 5 KB exe with `csc.exe` (shipped with the .NET Framework) that
  **opens a real window** — the condition Discord's detection actually requires.
- The file's version info declares the game's name, not a borrowed system binary's.
- Stopping uses `taskkill /T /F` so child processes go with it.

`csc.exe` is looked for in two places:

```
%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
```

If neither exists, the tool falls back to the **windowless** tiers with a warning, and Discord
very likely will not detect it. Installing the .NET Framework is the fix.

## macOS / Linux

Two big differences from Windows:

1. **Discord's Unix-side list is tiny** — 62 games on macOS and 8 on Linux, against 10,447 on
   Windows.
2. **The placeholder owns no window.** It is a renamed copy of `/bin/sleep`. If Discord on Mac
   requires a window the way the Windows client does, this approach will not work —
   **it has not been tested on real hardware.**

macOS `.app` entries get a minimal app bundle (an `Info.plist` plus the binary in
`Contents/MacOS/`), so the process path ends with `Foo.app/Contents/MacOS/Foo` just like the real
game.

## Why Windows games are not offered on macOS

Technically it works — file extensions mean nothing on Unix, so you can create and run a file
named `redsteam.exe` on a Mac. It **was built once and then deliberately removed**, because:

> A process named `.exe` running on macOS cannot happen with a real game. It is a plain sign that
> something is being spoofed — a trivially detectable signal, and the risk is not worth the gain.

`Spoofer.candidates()` therefore filters out other platforms' executables every time.
**Do not reintroduce it.**

## Tier comparison

| Tier | Windows | macOS / Linux |
|---|---|---|
| 1 `compiled` | `csc.exe` → a 5 KB windowed exe | not available |
| 2 `system` | copy of `System32\waitfor.exe` + a unique signal token | copy of `/bin/sleep 999999` |
| 3 `node` | copy of `node.exe` + `keepalive.js` | copy of `node` + `keepalive.js` (`chmod 755`) |
| Stopping | `taskkill /PID <pid> /T /F` | `SIGTERM`, then `SIGKILL` after 3 s |

## Verification commands (Windows)

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

Clean up leftovers — a crashed server can leave placeholders behind:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*data\runtime*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Read next

- [How it works](EN-How-It-Works) — the window requirement and the tier chain
- [Troubleshooting & FAQ](EN-Troubleshooting) — Discord is not showing the game
- [Architecture](EN-Architecture) — the invariants not to break
