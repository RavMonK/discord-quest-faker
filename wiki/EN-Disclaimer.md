# ⚠️ Disclaimer & risks

[🏠 Home](Home) · [ไทย](TH-Disclaimer) · **English**

---

## Read this in full before using the tool

- This tool makes Discord **report that you are playing a game you are not actually playing**,
  which **violates Discord's Terms of Service**.
- Using it may get **quests voided, rewards revoked, or your account limited or banned**. You use
  it entirely at your own risk, and the author accepts no liability for any consequence.
- It is published for **educational and personal use only**. Do not sell it or use it abusively.
- This project is **not affiliated with, endorsed by, or connected to** Discord, Valve/Steam,
  SteamDB, or any game publisher. All game names and trademarks belong to their respective owners.
- The software is provided **"AS IS"**, without warranty of any kind — see
  [LICENSE](https://github.com/RavMonK/discord-quest-faker/blob/main/LICENSE).
- **If you are not willing to accept those risks, do not use it.**

## What the tool does and does not do

**It does**

- Run processes on your own machine whose file name and path match a game's executable
- Make an HTTP GET to Discord's public game-list endpoint (and to `api.steamcmd.net` when you ask
  it to add a Steam game)
- Download game icons from Discord's / Steam's CDN and cache them locally

**It does not**

- Read, use, or transmit any **Discord token, password, or account data**
- Modify, inject into, or patch the Discord client
- Send your data anywhere — to the author or anyone else (there is no telemetry at all)

Not touching credentials **does not make the usage compliant** with Discord's rules — the act
itself (reporting a false status to collect rewards) is the part that breaks them.

## Technical signals that could give it away

The tool tries to avoid unnatural traces, but **it is spoofing, and spoofing leaves marks**:

- The compiled placeholder is ~5 KB, nothing like a real game binary
- The process runs from a path under `data/runtime/`, not where a real game is installed
- On a fallback tier, the file's version info declares itself as Microsoft's `waitfor.exe`
- Cross-platform executables (`.exe` on macOS) were **deliberately removed** because that signal
  is far too obvious

There is no evidence Discord checks any of this today, and no guarantee it will not tomorrow.

## Scope: what this cannot do

Only **"play a game"** quests are in scope:

- ❌ Quests requiring you to **stream to a friend** — detected differently
- ❌ Quests requiring you to **watch a video**
- ❌ Games **absent from Discord's detectable list**
- ❌ Games added from Steam — status only, **no quest progress**
  (see [Steam games](EN-Steam-Games))
- ⚠️ The **desktop Discord client** must stay open the whole time

## License

[MIT](https://github.com/RavMonK/discord-quest-faker/blob/main/LICENSE) © 2026 RavMonK

## Read next

- [Project overview](EN-Overview)
- [Inherent limitations](EN-How-It-Works)
- [Troubleshooting & FAQ](EN-Troubleshooting)
