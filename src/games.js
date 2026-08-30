'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const OS_KEY = process.platform === 'win32' ? 'win32'
  : process.platform === 'darwin' ? 'darwin'
  : 'linux';

/** GET a JSON document. Uses fetch (node >= 18) with an https fallback. */
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

  merge() {
    const customIds = new Set(this.custom.map((g) => g.id));
    this.games = this.custom
      .concat(this.detectable.filter((g) => !customIds.has(g.id)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  addCustom(game) {
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

module.exports = { GameStore, OS_KEY, normalize, fetchJson, fold };
