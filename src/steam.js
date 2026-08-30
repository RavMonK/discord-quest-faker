'use strict';

const { fetchJson } = require('./games');

// steamdb.info itself is behind Cloudflare and refuses automated requests (HTTP 403), but the
// data its "config" page shows comes from Steam's appinfo - which this public mirror serves.
const APPINFO_API = 'https://api.steamcmd.net/v1/info/';

/** Accepts a bare app id, a steamdb.info URL, a store.steampowered.com URL or a steam:// link. */
function parseAppId(input) {
  const text = String(input || '').trim();
  if (/^\d+$/.test(text)) return text;

  const match = text.match(/(?:steamdb\.info\/app|steampowered\.com\/app|steamcommunity\.com\/app|steam:\/\/[a-z]+\/)\/?(\d+)/i)
    || text.match(/[?&]appids?=(\d+)/i);
  return match ? match[1] : null;
}

function osKeysFor(entry, appOsList) {
  const list = String((entry.config && entry.config.oslist) || appOsList || '').toLowerCase();
  const keys = [];
  if (list.includes('windows')) keys.push('win32');
  if (list.includes('macos') || list.includes('osx')) keys.push('darwin');
  if (list.includes('linux')) keys.push('linux');
  if (keys.length > 0) return keys;

  // Steam often leaves oslist empty - fall back to what the file name looks like.
  const exe = String(entry.executable || '').toLowerCase();
  if (exe.endsWith('.exe')) return ['win32'];
  if (exe.endsWith('.app') || exe.includes('.app/') || exe.includes('.app\\')) return ['darwin'];
  if (exe.endsWith('.sh') || exe.endsWith('.x86_64')) return ['linux'];
  return ['win32'];
}

/**
 * Steam's "executable" is often only a bootstrapper, with the real game binary named in the
 * launch entry's "arguments" - the Modern Warfare 4 beta runs bootstrapper.exe with the
 * argument cod26-cod.exe, and that second name is the one Discord's list carries.
 */
function executablesInArguments(args) {
  const matches = String(args || '').match(/[^\s"']+\.(?:exe|app|sh|bat|x86_64)/gi) || [];
  // Switches, not files. Counter-Strike 2 really does pass "-steam.exe" as an argument.
  return matches.filter((token) => !/^[-+/]/.test(token) && !token.includes('='));
}

/** Steam paths use backslashes and can carry junk we do not want to turn into directories. */
function normalizeExecutable(name) {
  const cleaned = String(name || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
  if (!cleaned) return null;
  if (cleaned.split('/').some((part) => part === '..')) return null;
  return cleaned.toLowerCase();
}

/**
 * Look up a Steam app and turn its launch options into the same shape the Discord detectable
 * list uses, so the rest of the program cannot tell the two apart.
 */
async function fetchGame(input) {
  const appId = parseAppId(input);
  if (!appId) throw new Error('could not find a Steam app id in "' + input + '"');

  let payload;
  try {
    payload = await fetchJson(APPINFO_API + appId);
  } catch (err) {
    throw new Error('Steam lookup failed: ' + err.message);
  }

  const app = payload && payload.data && payload.data[appId];
  if (!app || !app.common) throw new Error('Steam app ' + appId + ' not found');

  const common = app.common;
  const launch = (app.config && app.config.launch) || {};
  const executables = [];
  const seen = new Set();

  for (const key of Object.keys(launch)) {
    const entry = launch[key];
    if (!entry) continue;

    const names = [entry.executable]
      .concat(executablesInArguments(entry.arguments))
      .map(normalizeExecutable)
      .filter(Boolean);

    for (const name of names) {
      for (const os of osKeysFor(entry, common.oslist)) {
        const dedupe = os + '|' + name;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        executables.push({
          name,
          os,
          // Steam's own launcher/bootstrapper entries are the least game-like ones
          isLauncher: /^(start_protected_game|bootstrapper|launcher)\b/.test(name.split('/').pop())
        });
      }
    }
  }

  if (executables.length === 0) {
    throw new Error(common.name + ' (' + appId + ') has no launch executable in its Steam config');
  }

  return {
    id: 'steam:' + appId,
    appId,
    name: common.name || 'Steam app ' + appId,
    aliases: [],
    icon: null,
    iconUrl: common.icon
      ? 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/' + appId + '/' + common.icon + '.jpg'
      : null,
    custom: true,
    source: 'steam',
    executables
  };
}

module.exports = { fetchGame, parseAppId, APPINFO_API };
