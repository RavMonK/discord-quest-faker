# Changelog

## 1.6.0 - 2026-09-26

### Added

- Add a game by its **process path** when neither Discord's list nor Steam has a usable one —
  e.g. `EA SPORTS FC 27\FC27.exe`. A new row under the Steam box in the control panel,
  `--add-exe <path>` (with `--name` / `--id` / `--force`) on the CLI, and
  `POST /api/custom { executable, name, id }` in the API. A full path copied out of Task Manager
  works (the drive letter is dropped); `..`, characters Windows forbids, a non-`.exe` name on
  Windows and a `.exe` name on macOS/Linux are refused. Such games get a `custom` tag, live in
  `data/custom-games.json`, and a second path under the same name adds to the same game.
- A **Discord game id** (⋯ → *Copy Game ID* on the game's profile) can lead the path
  (`1531874756096295054\EA SPORTS FC 27\FC27.exe`), go in the name box, or be passed as `--id`.
  The entry then uses Discord's application id, and its name and icon are looked up from
  Discord's public `/applications/<id>/rpc` endpoint.
- A typed path that is — or is the tail of — an executable Discord already lists (`FC26.exe` →
  *EA Sports FC 26*) points you at Discord's entry instead (`findExecutableTwin()`), same as a
  Steam add; **Add anyway** / `--force` overrides.

### Changed

- A custom entry on a Discord game id now **adds** its executables to Discord's entry instead
  of replacing it, so an entry saved before Discord lists a game's executables never hides them
  afterwards.
- Wiki (TH/EN): Steam Games, CLI Reference, HTTP API, Control Panel and Configuration document
  process-path adds and the Discord game id.

### Known limitation

- A detectable entry with **no executables** cannot be made to register. EA Sports FC 27 is one
  right now: its entry lists only third-party SKUs, so no process name can match it. Starting
  the placeholder with Steam's `SteamAppId` in its environment was tried and makes no
  difference. Keep the custom entry; it starts counting once Discord adds the executables.

### Testing

- 101 tests (94 run, 7 skipped as OS-specific), including path parsing, Discord game ids, the
  Discord lookup (stubbed), executable merging, the twin check and the new API branch.

Full changelog: [v1.5.1...v1.6.0](https://github.com/RavMonK/discord-quest-faker/compare/v1.5.1...v1.6.0)

## 1.5.1 - 2026-09-26

### Fixed

- `--add-steam` saved a launcher URI as an executable name. EA SPORTS FC 27 (Steam 4080220)
  launches through `steam2ea://launchgame/4080220?...`, which became a broken custom entry with a
  "file" that no process could ever be named. `normalizeExecutable()` now drops anything shaped
  `scheme://...` (new `isLauncherUri()`), and an app whose launch config holds only such URIs is
  refused with an error naming the external launcher instead of the generic "no launch
  executable".

### Changed

- Steam Games wiki (TH/EN) documents launcher-URI apps and why they cannot be added from Steam.

### Testing

- 93 tests (88 run, 5 skipped as OS-specific), including a new launcher-URI case.

Full changelog: [v1.5.0...v1.5.1](https://github.com/RavMonK/discord-quest-faker/compare/v1.5.0...v1.5.1)

## 1.5.0 - 2026-09-19

Quality pass across the whole project: accessibility and mobile support for the control panel, a
wider test net, and a handful of correctness fixes in the spoofer. No new dependencies.

### Fixed

- README and wiki badges claimed Node.js >= 18 while `engines` requires 22/24/26 and older majors
  are rejected at startup - the badges now say so.
- A superseded launch inside `startOne()` could overwrite `session.launchedAt` while the previous
  child's exit handler was still going to read it, misreporting how long that child had lived. Each
  launch now keeps its own timestamp.
- `cscString()` duplicated `cString()`'s escaping; it now shares it.
- Game icon downloads gave up after 8 s, too soon for a large image on a slow link - now 30 s.

### Added

- Control panel accessibility: every icon-only button (star, remove, expander, queue controls) has
  an `aria-label`, and every interactive element shows a `:focus-visible` ring. The muted text
  colour now meets WCAG AA contrast on the panel background.
- Mobile layout: below 640 px the panels stack, the Steam row goes vertical and buttons get 44 px
  touch targets.
- The toast slides and fades instead of popping; running timers always render `HH:MM:SS`; the game
  list shows a loading pulse while it refreshes; `/` focuses the search box and `Escape` clears it;
  a footer link brings the disclaimer banner back after it was dismissed.
- `Spoofer.offSessionEnd()` removes a session-end listener.

### Changed

- The compiled-placeholder cache is capped at 500 entries instead of growing without bound.
- Empty states tell the user what to do next, and the preset empty state no longer uses `innerHTML`.
- Getting Started (TH/EN) now says up front that Discord's list is overwhelmingly Windows and that
  quest credit on macOS/Linux is still unconfirmed.

### Testing

- 92 tests (87 run, 5 skipped as OS-specific): new CLI smoke tests, a real HTTP server smoke suite
  (static files, token flow, Host/Origin/Content-Type and pagination validation), a concurrent
  game-list refresh test, explicit skip reasons, and a 30 s test timeout.
- GitHub Actions now also runs the suite on Windows and macOS, not just Linux.

Full changelog: [v1.4.0...v1.5.0](https://github.com/RavMonK/discord-quest-faker/compare/v1.4.0...v1.5.0)

## 1.4.0 - 2026-09-05

A windowed placeholder on Linux: the `compiled` tier now exists on all three platforms.

### Added

- Linux `compiled` tier: `compileLinux()` builds a ~72 KB X11 placeholder with any C compiler (`$CC`, `cc`, `gcc` or `clang`) and maps a real 480x160 window showing the game, the executable being impersonated, the elapsed clock and the auto-stop countdown. Closing the window ends the session, as on Windows and macOS.
- Xlib is reached through `dlopen`/`dlsym`, so the build needs no X11 headers, no development package and no `-lX11` - only a compiler and a `DISPLAY`.
- The window carries `WM_CLASS`, `_NET_WM_PID` and `WM_DELETE_WINDOW`, and its title goes through `_NET_WM_NAME` as UTF-8; the drawn text is ASCII-folded because a core X font is single byte.
- The Linux tier chain is now `compiled` -> `system` -> `node`. With no compiler, or no display to map a window on, it falls back as before and the warning names the missing half.

### Changed

- No icon is downloaded on Linux: that window cannot decode a PNG without a library, so it draws the game's initial instead of fetching bytes nobody looks at.
- `PLACEHOLDER_BUILD` bumped to 4, which rebuilds every cached placeholder once.
- `Spoofer.objcString()` is now `Spoofer.cString()`; the C and Objective-C sources escape string literals identically.
- Thai and English documentation updated for the Linux window, its requirements and how to verify it.

### Validation

- 82 tests (77 run, 5 skipped as OS-specific), including the generated Linux source, `linuxCompiler()`, `asciiLabel()` and a real compiled placeholder that is asserted to own an X window through `xwininfo`.
- Verified on Linux ARM64 (Kali, X11) with Node.js 22.23.2: window mapped and named, `/proc/<pid>/exe` at the fake game path, auto-stop and window-close both ending the session cleanly.
- With `DISPLAY` unset the compiled tier refuses to build and the session drops to `system`, which the suite tests directly.
- Whether Discord's Linux client credits a quest for it is still unconfirmed, exactly as on macOS.

Full changelog: [v1.3.0...v1.4.0](https://github.com/RavMonK/discord-quest-faker/compare/v1.3.0...v1.4.0)

## 1.3.0 - 2026-09-05

Security hardening for the local control panel and generated executables, with Linux regression coverage.

### Security fixes

- Require a per-process API token and validate Host, Origin and Fetch Metadata to reject cross-site commands. The browser obtains and refreshes its session automatically.
- Return HTTP errors for malformed Host headers and request URLs instead of terminating the server.
- Validate pagination: `limit` must be an integer from 1 to 500 and `offset` a non-negative safe integer.
- Validate game IDs and executable paths, enforce containment within the runtime directory, and reject existing symlinks along generated paths.
- Verify copied executables with SHA-256 instead of trusting their file size. Replace altered files atomically and fail closed if replacement fails. Use independent copies on every OS so modifying a placeholder cannot modify its source through a hard link.
- Trust compiled-placeholder cache entries only when the name, build version and SHA-256 match an in-memory record made by the current process. Disk stamps are no longer trusted.

### Upgrade notes

- Use an up-to-date Node.js 22, 24 or 26 release; Node.js 24 LTS is recommended. Node.js 18/20 and other unsupported major versions are rejected at startup.
- The panel now accepts loopback connections only. Set `host` to `127.0.0.1`, `localhost` or `::1`; LAN/wildcard bind addresses are rejected.
- API scripts must obtain a token from `GET /api/session` and pass it as `X-DQF-Token` on all other API requests. POST/PATCH/DELETE also require `Content-Type: application/json`, including requests without a body. Tokens change when the server restarts.
- A compiled placeholder is rebuilt on its first start after restarting the tool; verified builds can be reused during that run.
- Local applications can obtain a session token. These checks protect against websites and untrusted cached files; they do not sandbox a compromised local account.
- Thai and English setup, API, architecture and testing documentation have been updated. No npm dependencies were added.

### Validation

- 77 tests, including HTTP security regressions, executable integrity, frontend session recovery and real Linux process tests.
- Verified in non-root, network-isolated Linux ARM64 containers on Node.js 22.23.2, 24.20.0 and 26.8.1: 77/77 passed on each.
- Linux tests verify system and Node placeholders, `/proc/<pid>/exe`, duplicate-start rejection, explicit stop and duration-based stop.
- GitHub Actions runs the suite and CLI smoke checks on Linux with Node.js 22, 24 and 26 for pull requests and updates to `main`.
- Windows GUI behavior and Discord quest credit on Linux were not verified in this release's testing.

Full changelog: [v1.2.0...v1.3.0](https://github.com/RavMonK/discord-quest-faker/compare/v1.2.0...v1.3.0)
