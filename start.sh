#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js was not found."
  echo "    Install it from https://nodejs.org (or: brew install node) and run this again."
  exit 1
fi

exec node src/index.js "$@"
