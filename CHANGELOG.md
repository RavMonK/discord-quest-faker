# Changelog

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
