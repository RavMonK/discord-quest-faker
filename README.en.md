# Discord Quest Faker

[ภาษาไทย](README.md) · **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Platform: Windows | macOS | Linux](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Platform-Notes)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![Wiki: ไทย | English](https://img.shields.io/badge/wiki-ไทย%20%7C%20English-blue)](https://github.com/RavMonK/discord-quest-faker/wiki)

A small tool that fetches **Discord's detectable-game list** (~10,400 games), caches it as JSON,
and spawns placeholder processes whose name and path match one of a game's executables — so
Discord reports the game as running and *"play game X for Y minutes"* quests progress. Everything
is driven from a control panel on your own machine.

Pure Node.js with **zero external dependencies** — `npm install` is never needed.

<p align="center">
  <img src="docs/screenshots/control-panel.png" alt="Discord Quest Faker control panel running Overwatch, with the preset list and the game search box" width="820">
</p>

---

## ⚠️ Disclaimer

- This tool makes Discord **report a status that is not true**, which **violates Discord's Terms
  of Service**.
- It may get **quests voided, rewards revoked, or your account limited or banned** — the risk is
  entirely yours.
- Published for **educational and personal use only**, with no warranty of any kind ([LICENSE](LICENSE)).
- **Not affiliated with** Discord, Valve/Steam, SteamDB, or any game publisher, and it never
  reads or transmits any token, password, or account data.
- **If you are not willing to accept those risks, do not use it.**

Full version: [English](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Disclaimer) ·
[ภาษาไทย](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Disclaimer)

---

## Quick start

You need **Node.js 22/24/26 (24 LTS recommended)** and the **desktop Discord client** running (the web version cannot
detect games).

```bash
node src/index.js          # on Windows, double-clicking start.bat works too
./start.sh                 # macOS / Linux
```

The control panel opens at <http://127.0.0.1:5011> → search a game → press **Start** → a small
window titled with the game name appears. That is the placeholder process — **do not close it**,
closing it is the same as pressing Stop.

Two switches inside Discord are also required, or it runs for nothing:
**Activity Privacy → Share your detected activities** and
**Registered Games → Display currently running game**
([step by step](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Getting-Started)).

---

## 📖 Documentation (Wiki — English / ไทย)

Everything lives in the [wiki](https://github.com/RavMonK/discord-quest-faker/wiki), in both
languages. The source files are in the [`wiki/`](wiki/) folder of this repo.

| Topic | English | ไทย |
|---|---|---|
| Project overview | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Overview) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Overview) |
| Getting started | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Getting-Started) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Getting-Started) |
| How it works (why a real window is required) | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-How-It-Works) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-How-It-Works) |
| Control panel | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Control-Panel) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Control-Panel) |
| CLI reference | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-CLI-Reference) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-CLI-Reference) |
| Configuration (`config.json`) | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Configuration) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Configuration) |
| Adding Steam games | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Steam-Games) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Steam-Games) |
| Platform notes | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Platform-Notes) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Platform-Notes) |
| Troubleshooting & FAQ | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Troubleshooting) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Troubleshooting) |
| Architecture | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Architecture) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Architecture) |
| HTTP API | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-HTTP-API) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-HTTP-API) |
| Development & testing | [EN](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Development) | [TH](https://github.com/RavMonK/discord-quest-faker/wiki/TH-Development) |

**Discord is not showing the game?** Start with
[Troubleshooting](https://github.com/RavMonK/discord-quest-faker/wiki/EN-Troubleshooting).

---

## License

[MIT](LICENSE) © 2026 RavMonK

The windowed-placeholder approach follows
[markterence/discord-quest-completer](https://github.com/markterence/discord-quest-completer).
