'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const OS_KEY = process.platform === 'win32' ? 'win32'
  : process.platform === 'darwin' ? 'darwin'
  : 'linux';

/** GET a JSON document. Uses the runtime's fetch with an https fallback. */
async function fetchJson(apiUrl) {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (discord-quest-faker)'
  };

  if (typeof fetch === 'function') {
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  }

  return new Promise((resolve, reject) => {
    https.get(apiUrl, { headers }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/** Strip the 12MB API payload down to the fields the runner and UI actually need. */
function normalize(rawList) {
  const games = [];
  for (const app of rawList) {
    if (!app || !Array.isArray(app.executables) || app.executables.length === 0) continue;

    const executables = app.executables
      .filter((exe) => exe && typeof exe.name === 'string' && exe.name.length > 0)
      // Discord's list is developer-submitted; a ".." segment would let it escape the
      // per-game directory materialize() builds it under.
      .filter((exe) => !exe.name.replace(/\\/g, '/').split('/').some((part) => part === '..'))
      .map((exe) => ({
        name: exe.name,
        os: exe.os || 'win32',
        isLauncher: Boolean(exe.is_launcher)
      }));
    if (executables.length === 0) continue;

    games.push({
      id: String(app.id),
      name: app.name || '(unnamed)',
      aliases: Array.isArray(app.aliases) ? app.aliases : [],
      icon: app.icon_hash || null,
      executables
    });
  }
  games.sort((a, b) => a.name.localeCompare(b.name));
  return games;
}

/**
 * Lowercase and drop accents, so "marvel tokon" finds "MARVEL Tōkon" and "pokemon" finds
 * "Pokémon". Without this, any game whose real name carries a diacritic is unsearchable.
 */
function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Clean up a process path someone typed - "EA SPORTS FC 27\FC27.exe", or the full path copied
 * out of Task Manager - into the forward-slash relative form the detectable list uses. Throws
 * with a readable reason instead of letting materialize() refuse it at start time.
 */
function parseProcessPath(input, osKey = OS_KEY) {
  const text = String(input || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!text) throw new Error('type the game\'s process path, e.g. EA SPORTS FC 27\\FC27.exe');

  // A drive letter or leading slash only anchors the path on the real machine. Discord matches
  // the tail, and the placeholder lives under data/runtime/<id>/ anyway.
  const parts = text.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '').split('/')
    .filter((part) => part && part !== '.');
  if (parts.length === 0) throw new Error('"' + text + '" has no file name in it');
  if (parts.some((part) => part === '..')) throw new Error('a process path cannot contain ".."');
  if (parts.some((part) => /[\x00-\x1f<>:"|?*]/.test(part))) {
    throw new Error('a process path cannot contain < > : " | ? * (except a leading drive letter)');
  }
  if (parts.some((part) => /[. ]$/.test(part))) {
    throw new Error('a folder or file name cannot end with a dot or a space');
  }

  const relative = parts.join('/');
  if (relative.length > 200) throw new Error('that process path is too long (200 characters max)');

  const base = parts[parts.length - 1].toLowerCase();
  if (osKey === 'win32' && !base.endsWith('.exe')) {
    throw new Error('a Windows process name ends in .exe - e.g. EA SPORTS FC 27\\FC27.exe');
  }
  // A foo.exe process on macOS or Linux cannot be a real game, which makes it an easy tell.
  if (osKey !== 'win32' && base.endsWith('.exe')) {
    throw new Error('.exe is a Windows process name - on ' + osKey + ' use the name the game really runs as');
  }
  return relative;
}

// A Discord application id ("Copy Game ID" on a game's profile) is a snowflake.
const DISCORD_ID = /^\d{17,20}$/;

/**
 * A hand-typed process path as a game in the detectable-list shape.
 *
 * The id is the Discord game id when one is given - as the path's first segment
 * ("1531874756096295054\EA SPORTS FC 27\FC27.exe") or in place of the name - so the entry sits
 * on the same application Discord shows (and its icon resolves). Discord can know a game, even
 * run a quest for it, before its detectable entry lists any executable: EA Sports FC 27 did.
 * Without an id, the id comes from the name, so a second executable under the same name lands
 * on the same game. The name defaults to the folder the executable sits in ("EA SPORTS FC 27"),
 * which is how Discord's own entries for such games are laid out.
 */
function customGame(input, name, osKey = OS_KEY, gameId = '') {
  let parts = parseProcessPath(input, osKey).split('/');
  let typedName = String(name || '').trim();
  let id = String(gameId || '').trim();

  if (parts.length > 1 && DISCORD_ID.test(parts[0])) {
    if (id && id !== parts[0]) throw new Error('two different game ids: ' + parts[0] + ' and ' + id);
    id = parts[0];
    parts = parts.slice(1);
  }
  if (!id && DISCORD_ID.test(typedName)) {
    id = typedName;
    typedName = '';
  }
  if (id && !DISCORD_ID.test(id)) throw new Error('"' + id + '" is not a Discord game id (Copy Game ID gives 17-20 digits)');

  const relative = parts.join('/');
  const fallback = parts.length > 1 ? parts[parts.length - 2] : parts[0].replace(/\.[^.]+$/, '');
  const title = typedName.slice(0, 100) || fallback;

  // Spoofer.gameDirectory() only accepts [a-z0-9._-], so a name with nothing Latin in it
  // (a Thai title, say) gets a short hash instead of an empty slug.
  const slug = fold(title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    || crypto.createHash('sha1').update(title).digest('hex').slice(0, 12);

  return {
    id: id || 'custom-' + slug,
    // whether the name was typed, so a lookup of the Discord id knows it must not replace it
    namedByUser: Boolean(typedName),
    name: title,
    aliases: [],
    icon: null,
    iconUrl: null,
    custom: true,
    source: 'custom',
    executables: [{ name: relative, os: osKey, isLauncher: false }]
  };
}

/**
 * Fill a customGame() in from Discord when its id is a Discord game id: the public /rpc
 * endpoint answers without auth and carries the name and icon hash (not the executables - a
 * game that has none in the detectable list has none there either). A failed lookup is not an
 * error; the entry keeps the name it already has. Always call this before saving: it also drops
 * the `namedByUser` marker, which does not belong on disk.
 */
async function withDiscordDetails(game, fetcher = fetchJson) {
  const { namedByUser, ...entry } = game;
  if (!DISCORD_ID.test(entry.id)) return { game: entry, looked: false };
  try {
    const app = await fetcher('https://discord.com/api/v10/applications/' + entry.id + '/rpc');
    if (!app || String(app.id) !== entry.id) throw new Error('unexpected response');
    if (!namedByUser && app.name) entry.name = String(app.name).slice(0, 100);
    // the hash ends up inside a CDN URL, so take nothing but a hash
    if (/^(?:a_)?[0-9a-f]{32}$/.test(String(app.icon || ''))) entry.icon = String(app.icon);
    return { game: entry, looked: true };
  } catch (err) {
    return { game: entry, looked: false, error: err.message };
  }
}

function writeAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

class GameStore {
  constructor(config) {
    this.config = config;
    this.games = [];        // detectable list + custom entries, what everything else reads
    this.detectable = [];   // straight from Discord
    this.custom = [];       // games added by hand, e.g. looked up on Steam
    this.fetchedAt = null;
    this.source = 'empty';
    this.refreshing = false;
    this.lastError = null;
    this.loadCustom();
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.config.gamesPath)) {
        this.merge();
        return false;
      }
      const parsed = JSON.parse(fs.readFileSync(this.config.gamesPath, 'utf8'));
      const games = Array.isArray(parsed) ? parsed : parsed.games;
      if (!Array.isArray(games)) return false;
      this.detectable = games;
      this.fetchedAt = (parsed && parsed.fetchedAt) || null;
      this.source = 'cache';
      this.merge();
      console.log(`[games] loaded ${games.length} games from cache (${this.config.gamesFile})`);
      return true;
    } catch (err) {
      console.error(`[games] could not read cache: ${err.message}`);
      return false;
    }
  }

  /** Custom entries live in their own file so a list refresh never wipes them. */
  loadCustom() {
    try {
      if (!fs.existsSync(this.config.customPath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.config.customPath, 'utf8').replace(/^﻿/, ''));
      const games = Array.isArray(parsed) ? parsed : parsed.games;
      if (!Array.isArray(games)) return;
      this.custom = games.filter((g) => g && g.id && Array.isArray(g.executables));
      if (this.custom.length) console.log(`[games] loaded ${this.custom.length} custom game(s)`);
    } catch (err) {
      console.error(`[games] could not read custom games: ${err.message}`);
    }
  }

  saveCustom() {
    writeAtomic(this.config.customPath, `${JSON.stringify({
      updatedAt: new Date().toISOString(),
      games: this.custom
    }, null, 2)}\n`);
  }

  /**
   * A custom entry on a Discord game id adds its executables to Discord's entry rather than
   * hiding it: Discord's own paths are the ones it detects, and it may add them any day after
   * the custom entry was saved (EA Sports FC 27 started out with none).
   */
  merge() {
    const custom = new Map(this.custom.map((g) => [g.id, g]));
    const merged = this.detectable.map((known) => {
      const own = custom.get(known.id);
      if (!own) return known;
      custom.delete(known.id);
      const seen = new Set(known.executables.map((e) => e.os + '|' + e.name.toLowerCase()));
      return Object.assign({}, known, {
        custom: true,
        source: own.source,
        executables: known.executables.concat(
          own.executables.filter((e) => !seen.has(e.os + '|' + e.name.toLowerCase())))
      });
    });
    this.games = merged.concat([...custom.values()]).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * `merge` keeps the executables an existing custom entry with the same id already has, so
   * typing a second process path under the same game name adds to it instead of replacing it.
   */
  addCustom(game, { merge = false } = {}) {
    const existing = merge ? this.custom.find((g) => g.id === game.id) : null;
    if (existing) {
      const seen = new Set(existing.executables.map((e) => e.os + '|' + e.name.toLowerCase()));
      // newer details (a name, an icon, a Steam app id looked up since) win; paths accumulate
      game = Object.assign({}, existing, game, {
        executables: existing.executables.concat(
          game.executables.filter((e) => !seen.has(e.os + '|' + e.name.toLowerCase())))
      });
    }
    this.custom = this.custom.filter((g) => g.id !== game.id).concat([game]);
    this.saveCustom();
    this.merge();
    return game;
  }

  removeCustom(id) {
    const before = this.custom.length;
    this.custom = this.custom.filter((g) => g.id !== String(id));
    if (this.custom.length === before) return false;
    this.saveCustom();
    this.merge();
    return true;
  }

  /** Fetch from Discord and overwrite the json cache. Keeps the old list on failure. */
  async refresh() {
    if (this.refreshing) return { ok: false, reason: 'already refreshing' };
    this.refreshing = true;
    this.lastError = null;
    const startedAt = Date.now();
    try {
      console.log('[games] fetching detectable game list from Discord ...');
      const raw = await fetchJson(this.config.apiUrl);
      if (!Array.isArray(raw)) throw new Error('unexpected API response (not an array)');

      const games = normalize(raw);
      if (games.length === 0) throw new Error('API returned an empty game list');

      this.detectable = games;
      this.fetchedAt = new Date().toISOString();
      this.source = 'api';
      this.merge();

      writeAtomic(this.config.gamesPath, `${JSON.stringify({
        fetchedAt: this.fetchedAt,
        source: this.config.apiUrl,
        count: games.length,
        games
      }, null, 2)}\n`);

      console.log(`[games] saved ${games.length} games to ${this.config.gamesFile} (${Date.now() - startedAt}ms)`);
      return { ok: true, count: games.length, fetchedAt: this.fetchedAt };
    } catch (err) {
      this.lastError = err.message;
      console.error(`[games] refresh failed: ${err.message}${this.games.length ? ' - keeping cached list' : ''}`);
      return { ok: false, reason: err.message };
    } finally {
      this.refreshing = false;
    }
  }

  byId(id) {
    return this.games.find((g) => g.id === String(id)) || null;
  }

  /** Loose lookup so the CLI and config presets can reference a game by name too. */
  resolve(idOrName) {
    if (!idOrName) return null;
    const needle = fold(String(idOrName).trim());
    return this.byId(idOrName)
      || this.games.find((g) => fold(g.name) === needle)
      || this.games.find((g) => g.aliases.some((a) => fold(a) === needle))
      || this.games.find((g) => g.executables.some((e) => fold(e.name) === needle))
      || this.games.find((g) => fold(g.name).includes(needle))
      || null;
  }

  /**
   * Search, optionally restricted to games that are spoofable on this OS.
   * `offset` exists so the UI can page through the whole list as it scrolls.
   */
  search(query, { limit = 200, offset = 0, osKey = OS_KEY, onlyThisOs = true } = {}) {
    const needle = fold(String(query || '').trim());
    const results = [];

    for (const game of this.games) {
      // Same order the runner uses (launchers last), so index 0 here is what a plain Start runs.
      const executables = (onlyThisOs ? game.executables.filter((e) => e.os === osKey) : game.executables)
        .slice()
        .sort((a, b) => Number(a.isLauncher) - Number(b.isLauncher));
      if (onlyThisOs && executables.length === 0) continue;

      if (needle) {
        const haystack = fold([game.name, game.id, ...game.aliases, ...executables.map((e) => e.name)].join(' '));
        if (!haystack.includes(needle)) continue;
      }

      results.push({
        id: game.id,
        name: game.name,
        icon: game.icon,
        iconUrl: game.iconUrl || null,
        custom: Boolean(game.custom),
        source: game.source || 'discord',
        executables
      });
    }

    // exact-ish matches first, then alphabetical
    if (needle) {
      results.sort((a, b) => {
        const rank = (n) => (fold(n) === needle ? 0 : fold(n).startsWith(needle) ? 1 : 2);
        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
      });
    }

    const start = Math.max(0, offset);
    return { total: results.length, offset: start, items: results.slice(start, start + limit) };
  }

  meta() {
    return {
      count: this.games.length,
      custom: this.custom.length,
      playableHere: this.games.filter((g) => g.executables.some((e) => e.os === OS_KEY)).length,
      fetchedAt: this.fetchedAt,
      source: this.source,
      refreshing: this.refreshing,
      lastError: this.lastError,
      file: this.config.gamesFile
    };
  }
}

module.exports = { GameStore, OS_KEY, normalize, fetchJson, fold, parseProcessPath, customGame, withDiscordDetails };
