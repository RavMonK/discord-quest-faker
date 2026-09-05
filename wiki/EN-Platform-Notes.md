# Platform notes

[🏠 Home](Home) · [ไทย](TH-Platform-Notes) · **English**

---

## The short version

| OS | Games with an executable | Placeholder owns a window | Status |
|---|---|---|---|
| **Windows** | 10,447 | ✅ yes (`compiled` tier) | Fully working, tested |
| **macOS** | **62** | ✅ yes (`compiled` tier) | Needs the Xcode CLT · answers every signal Discord can read; whether it credits a quest is still unconfirmed |
| **Linux** | 8 | ✅ yes (`compiled` tier) | Needs any C compiler and an X/XWayland session · the window is verified on X11; whether Discord credits a quest there is still unconfirmed |

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
2. **The macOS `compiled` tier needs the Xcode Command Line Tools** — `clang` plus the Cocoa
   SDK. Without them it falls through to the `node` tier, which **owns no window**, and says so
   along with the `xcode-select --install` that fixes it.
3. **The Linux `compiled` tier needs a C compiler and a display** — any of `cc`, `gcc` or
   `clang` (or whatever `$CC` names), and `DISPLAY` pointing at an X or XWayland session.
   Without either it falls through to `system`, which **owns no window**, and the warning names
   the half that is missing.

macOS `.app` entries get a minimal app bundle (an `Info.plist` plus the binary in
`Contents/MacOS/`), so the process path ends with `Foo.app/Contents/MacOS/Foo` just like the real
game.

### The window on macOS

`compileMac()` compiles a real ~56 KB Cocoa app with `clang`, straight to the fake path. It runs
`NSApplication` at the `Regular` activation policy and holds an `NSWindow` open (game name, icon,
elapsed clock, and when it stops by itself). Closing that window ends the session, exactly as on
Windows.

Discord's `discord_utils.node` imports `proc_pidpath`, `sysctl`, `proc_pidinfo`,
`NSWorkspace`/`NSRunningApplication` and `CGWindowListCopyWindowInfo`. The `compiled` tier answers
all three of those that matter:

| Signal | `compiled` | `node` |
|---|---|---|
| `proc_pidpath()` returns the game's fake path | ✅ | ✅ |
| `lsappinfo` / NSWorkspace lists it as an app (`type="Foreground"`) | ✅ | ❌ |
| `CGWindowListCopyWindowInfo` finds an on-screen window at layer 0 | ✅ | ❌ |

### macOS does not use `/bin/sleep` any more

It used to, and it failed every time. macOS ties a *launch constraint* to Apple's own binaries:
copy `/bin/sleep` anywhere else and run it, and the code signing monitor SIGKILLs the copy —
measured between 4 and 113 seconds after launch, with `CODESIGNING` / `Launch Constraint
Violation` filed in `~/Library/Logs/DiagnosticReports/`. The `system` tier is therefore excluded
on macOS and the `node` tier is the only one left; the Node binary carries no such constraint and
stays up indefinitely (longest run tested: a full 5 minutes, no death).

Two more rules macOS imposes, neither of which may be reverted:

- **Never hard link on macOS** — always copy. A hard link shares its inode with the real Node
  binary, and `proc_pidpath()` (the call Discord uses to read a process's executable path) then
  answers with whichever name of that inode the kernel's cache holds. The same placeholder was
  observed reporting both its correct fake path and `.../node/bin/node`; on the latter, Discord
  sees a process called `node` and detection cannot work.
- **Never rewrite an unchanged `Info.plist`** — once macOS has launched a bundle it stamps it
  `com.apple.provenance`, and App Management protection refuses every write inside the `.app`
  (`EPERM`, even after unlinking the file first). Deleting the whole bundle is still permitted,
  which is the escape hatch when the plist genuinely has to change.

### The window on Linux

`compileLinux()` compiles a ~72 KB X11 program with whatever C compiler is installed, straight
to the fake path. It maps one fixed 480x160 window that shows the game's name, the executable
being impersonated, the elapsed clock and when the session stops by itself. Closing the window
ends the session, exactly as on Windows and macOS.

Two things make this tier cheap enough to be the default:

- **Xlib is opened with `dlopen`, not linked.** Every entry point is looked up by name, so the
  build needs no X11 headers, no development package and no `-lX11` — only a compiler. Any
  machine running an X or XWayland session already has `libX11.so.6`.
- **Nothing is compiled in but the text.** The name, the label and the executable name become
  string constants; the clock and the auto-stop countdown arrive as command line arguments, so
  one build serves every session of that game and stays cached.

What it cannot do is show the game's picture: decoding a PNG needs a library, and this has none,
so the badge shows the game's initial and no icon is downloaded on Linux at all. The drawn text
is also ASCII-folded (`MARVEL Tōkon` → `MARVEL Tokon`), because a core X font is single byte —
the window's real title goes through `_NET_WM_NAME` as UTF-8 and keeps the accents.

The window also carries what a real application's window carries: `WM_CLASS` (the executable
name and the game's), `_NET_WM_PID` (its own pid) and `WM_DELETE_WINDOW`, so a window manager
asks it to close rather than killing it.

**What is verified and what is not.** On X11 the window is really there — mapped, 480x160, named
and classed after the game, with `_NET_WM_PID` matching the placeholder's pid — and
`/proc/<pid>/exe` is the fake game path. Whether Discord's Linux client then credits a quest is
**still unconfirmed**, exactly as on macOS. Discord's Linux detection reads `/proc`, which the
windowless tiers also satisfy; the window is there because every platform's detection has wanted
one so far, and because a session you cannot see is a session you forget to stop.

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
| 1 `compiled` | `csc.exe` → a 5 KB windowed exe | macOS: `clang` + Cocoa → a ~56 KB windowed app · Linux: `cc`/`gcc`/`clang` + `dlopen`ed Xlib → a ~72 KB windowed X11 program |
| 2 `system` | copy of `System32\waitfor.exe` + a unique signal token | Linux: copy of `/bin/sleep 999999` · macOS: **not available** |
| 3 `node` | copy of `node.exe` + `keepalive.js` | copy of `node` + `keepalive.js` (`chmod 755`) |
| Stopping | `taskkill /PID <pid> /T /F` | `SIGTERM`, then `SIGKILL` after 3 s |

## Verification commands (macOS)

On a Mac `ps` cannot be used to read a placeholder's path (`keepalive.js` sets `process.title`,
which overwrites the argv the process table shows), and `pgrep -f` matches your own shell command
line, so it will happily report a placeholder that is not running. Ask the kernel with the same
call Discord uses:

```bash
lsappinfo list | grep -A2 -i <game>          # macOS sees it as a running app
stat -f "links=%l inode=%i" <path>           # links must be 1; anything else is a hard link
python3 -c "import ctypes,ctypes.util,sys
libc=ctypes.CDLL(ctypes.util.find_library('c')); b=ctypes.create_string_buffer(4096)
libc.proc_pidpath(ctypes.c_int(int(sys.argv[1])),b,4096); print(b.value.decode())" <pid>
```

That last command must print the fake game path. If it prints the Node binary's path instead,
Discord sees a process called `node` and detection cannot work.

Whether it owns a window is the other half, and it is the same call Discord makes. Compile this
once with the `swiftc` that ships with the Command Line Tools:

```swift
import CoreGraphics; import Foundation
let target = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                      kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowOwnerPID as String] as? Int) == target {
  print("onscreen=\(w[kCGWindowIsOnscreen as String] ?? false) layer=\(w[kCGWindowLayer as String] ?? -1)")
}
```

`onscreen=true layer=0` is a normal application window. No output at all means the process owns
none — that is the windowless `node` fallback. Window titles read back empty without Screen
Recording permission; that is expected and does not mean the window is missing.

When a placeholder dies on its own, macOS files the reason in
`~/Library/Logs/DiagnosticReports/<name>-*.ips` — read the `exception` and `termination` keys out
of the JSON body. To clean up leftovers:

```bash
pkill -f "data/runtime"
```

## Verification commands (Linux)

Is the placeholder really running, and from the fake path?

```bash
for d in /proc/[0-9]*; do case "$(readlink $d/exe)" in *data/runtime*) echo "${d#/proc/} -> $(readlink $d/exe)";; esac; done
```

Does it own a window? (`x11-utils` provides both commands)

```bash
xwininfo -root -tree | grep -i <game>       # must list it at 480x160 with the game's name
xprop -id <window id> _NET_WM_PID WM_CLASS  # the pid must be the placeholder's
```

Clean up leftovers — a crashed server can leave placeholders behind:

```bash
pkill -f "data/runtime"
```

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
