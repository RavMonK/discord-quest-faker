'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { OS_KEY, fold } = require('./games');
const { Spoofer } = require('./spoof');
const steam = require('./steam');
const configModule = require('./config');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** "Call of Duty®: Modern Warfare® 4 - Beta" and "Call of Duty: Modern Warfare 4" -> same key. */
function titleKey(name) {
  return fold(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(beta|demo|playtest|open|closed|early access|test|trial|edition)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A Steam entry is only worth adding when Discord does not already track the game: Discord
 * awards quest progress against its own entry, whose executables can differ from Steam's
 * (the Modern Warfare 4 beta ships bootstrapper.exe, Discord looks for cod.exe).
 */
function findDetectableTwin(detectable, game) {
  const key = titleKey(game.name);
  const names = new Set(game.executables.map((e) => fold(e.name)));
  let best = null;
  let bestScore = 0;

  for (const known of detectable) {
    const knownKey = titleKey(known.name);
    let score = 0;

    if (knownKey && key && knownKey === key) score = 3;
    else if (known.executables.some((e) => names.has(fold(e.name)))) score = 2;
    else if (knownKey && key && ((key.length >= 8 && knownKey.includes(key))
      || (knownKey.length >= 8 && key.includes(knownKey)))) score = 1;

    // a weaker but longer title ("... modern warfare 4") beats a shorter loose match
    if (score > bestScore || (score > 0 && score === bestScore && knownKey.length > titleKey(best.name).length)) {
      best = known;
      bestScore = score;
    }
  }

  return best;
}

function serveStatic(req, res, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

/**
 * Starts the little control panel. Everything the UI needs goes through /api/*.
 */
function createServer({ config, store, spoofer, queue }) {
  /**
   * config.json only stores id/name/executable, so fill in what the UI draws with: the icon,
   * the executables the preset resolves to, and whether the game is still detectable.
   * Every endpoint that returns presets uses this - handing back the raw config entries left
   * the panel unable to render them.
   */
  const describePresets = () => config.presets.map((preset) => {
    const game = store.resolve(preset.id || preset.name);
    const executables = game ? Spoofer.candidates(game) : [];
    const selected = game ? Spoofer.select(game, preset.executable) : [];
    return {
      id: preset.id,
      name: preset.name || (game && game.name) || String(preset.id),
      // the stored choice, resolved so the panel always has a name to show
      executable: preset.executable || (selected[0] ? selected[0].name : undefined),
      // every executable of the game, in the same shape the game list uses, so the preset
      // rows can offer the same per-executable picker
      executables: executables.map((exe) => ({
        name: exe.name,
        os: exe.os,
        isLauncher: Boolean(exe.isLauncher)
      })),
      durationMinutes: preset.durationMinutes || 0,
      icon: game ? game.icon : null,
      iconUrl: game ? game.iconUrl || null : null,
      custom: game ? Boolean(game.custom) : false,
      missing: !game
    };
  });

  const startPreset = (preset) => {
    const game = store.resolve(preset.id || preset.name);
    if (!game) return { ok: false, reason: 'game not found: ' + (preset.id || preset.name) };
    return spoofer.start(game, {
      executable: preset.executable,
      durationMinutes: preset.durationMinutes
    });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const route = url.pathname;

    try {
      if (req.method === 'GET' && !route.startsWith('/api/')) {
        return serveStatic(req, res, route);
      }

      if (route === '/api/state' && req.method === 'GET') {
        return sendJson(res, 200, {
          os: OS_KEY,
          platform: process.platform,
          games: store.meta(),
          running: spoofer.list(),
          presets: describePresets(),
          queue: queue ? queue.describe() : null,
          settings: {
            defaultDurationMinutes: config.defaultDurationMinutes,
            maxConcurrent: config.maxConcurrent,
            refreshIntervalMinutes: config.refreshIntervalMinutes,
            configFile: path.basename(config.configPath)
          }
        });
      }

      if (route === '/api/games' && req.method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const onlyThisOs = url.searchParams.get('all') !== '1';
        return sendJson(res, 200, store.search(url.searchParams.get('q') || '', { limit, offset, onlyThisOs }));
      }

      if (route === '/api/custom' && req.method === 'POST') {
        const body = await readBody(req);
        try {
          const game = await steam.fetchGame(body.input);

          // Discord awards quest progress against its own entry, and its executable names can
          // differ from Steam's - the Modern Warfare 4 beta ships bootstrapper.exe while
          // Discord looks for cod26-cod.exe. Sending the user to the entry that actually works
          // beats saving a custom one that never gets detected.
          const known = findDetectableTwin(store.detectable, game);
          if (known && !body.force) {
            console.log('[custom] ' + game.name + ' matches detectable "' + known.name + '" - not adding');
            return sendJson(res, 200, {
              ok: true,
              added: false,
              useInstead: {
                id: known.id,
                name: known.name,
                executables: Spoofer.candidates(known).map((e) => e.name)
              },
              note: 'Discord already tracks this as "' + known.name + '" - opening that entry. '
                + 'Steam lists ' + game.executables.map((e) => e.name).join(', ')
                + ', but Discord looks for ' + Spoofer.candidates(known).map((e) => e.name).join(', '),
              games: store.meta()
            });
          }

          store.addCustom(game);
          console.log('[custom] added ' + game.name + ' (' + game.id + ') with '
            + game.executables.length + ' executable(s)');
          return sendJson(res, 200, {
            ok: true,
            added: true,
            game,
            note: 'Not in Discord\'s detectable list, so Discord will not label it on its own - '
              + 'add it under Settings > Registered Games while it runs',
            games: store.meta()
          });
        } catch (err) {
          return sendJson(res, 400, { ok: false, reason: err.message });
        }
      }

      if (route === '/api/custom' && req.method === 'DELETE') {
        const body = await readBody(req);
        spoofer.stopGame(body.id);
        const removed = store.removeCustom(body.id);
        return sendJson(res, removed ? 200 : 404, {
          ok: removed,
          reason: removed ? undefined : 'not a custom game',
          games: store.meta(),
          running: spoofer.list()
        });
      }

      if (route === '/api/refresh' && req.method === 'POST') {
        const result = await store.refresh();
        return sendJson(res, result.ok ? 200 : 502, Object.assign({}, result, { games: store.meta() }));
      }

      if (route === '/api/start' && req.method === 'POST') {
        const body = await readBody(req);
        const game = store.resolve(body.id || body.name);
        if (!game) return sendJson(res, 404, { ok: false, reason: 'game not found' });
        // body.executable: "all" | executable name | array of names | index | omitted
        const result = spoofer.start(game, {
          executable: body.executable,
          durationMinutes: body.durationMinutes
        });
        return sendJson(res, result.ok ? 200 : 409, Object.assign({}, result, { running: spoofer.list() }));
      }

      if (route === '/api/stop' && req.method === 'POST') {
        const body = await readBody(req);
        // A key stops one executable; an id stops every executable of that game.
        const result = body.key ? spoofer.stop(body.key) : spoofer.stopGame(body.id);
        return sendJson(res, result.ok ? 200 : 404, Object.assign({}, result, { running: spoofer.list() }));
      }

      if (route === '/api/stop-all' && req.method === 'POST') {
        // "stop everything" has to include the queue, or it would start the next game a few
        // seconds later and look like the button did not work
        if (queue) queue.stop();
        const stopped = spoofer.stopAll();
        return sendJson(res, 200, { ok: true, stopped, running: spoofer.list(), queue: queue ? queue.describe() : null });
      }


      /* ---- the quest queue: one game at a time, a random gap between each ---- */

      if (route === '/api/queue' && req.method === 'POST') {
        const body = await readBody(req);
        const result = queue.add({
          id: body.id || body.name,
          executable: body.executable,
          durationMinutes: body.durationMinutes
        });
        return sendJson(res, result.ok ? 200 : 404, Object.assign({}, result, { queue: queue.describe() }));
      }

      if (route === '/api/queue' && req.method === 'PATCH') {
        const body = await readBody(req);
        const result = queue.update(body.uid, body);
        return sendJson(res, result.ok ? 200 : 404, Object.assign({}, result, { queue: queue.describe() }));
      }

      if (route === '/api/queue' && req.method === 'DELETE') {
        const body = await readBody(req);
        const result = body.all ? queue.clear() : queue.remove(body.uid);
        return sendJson(res, result.ok ? 200 : 404, Object.assign({}, result, {
          queue: queue.describe(),
          running: spoofer.list()
        }));
      }

      if (route === '/api/queue/move' && req.method === 'POST') {
        const body = await readBody(req);
        const result = queue.move(body.uid, body.direction);
        return sendJson(res, result.ok ? 200 : 404, Object.assign({}, result, { queue: queue.describe() }));
      }

      if (route === '/api/queue/start' && req.method === 'POST') {
        const result = queue.start();
        return sendJson(res, result.ok ? 200 : 409, Object.assign({}, result, {
          queue: queue.describe(),
          running: spoofer.list()
        }));
      }

      if (route === '/api/queue/stop' && req.method === 'POST') {
        const result = queue.stop();
        return sendJson(res, 200, Object.assign({}, result, {
          queue: queue.describe(),
          running: spoofer.list()
        }));
      }

      if (route === '/api/queue/skip' && req.method === 'POST') {
        const result = queue.skip();
        return sendJson(res, result.ok ? 200 : 409, Object.assign({}, result, {
          queue: queue.describe(),
          running: spoofer.list()
        }));
      }

      if (route === '/api/queue/settings' && req.method === 'POST') {
        const body = await readBody(req);
        const delay = queue.setDelay(body.minSeconds, body.maxSeconds);
        return sendJson(res, 200, { ok: true, delay, queue: queue.describe() });
      }

      if (route === '/api/presets' && req.method === 'POST') {
        const body = await readBody(req);
        const game = store.resolve(body.id);
        if (!game) return sendJson(res, 404, { ok: false, reason: 'game not found' });
        if (config.presets.some((p) => String(p.id) === game.id)) {
          return sendJson(res, 200, { ok: true, presets: describePresets() });
        }
        const preferred = Spoofer.select(game, body.executable)[0];
        config.presets.push({
          id: game.id,
          name: game.name,
          executable: body.executable || (preferred ? preferred.name : undefined),
          durationMinutes: Number(body.durationMinutes) > 0 ? Number(body.durationMinutes) : 0
        });
        if (!configModule.save(config)) {
          return sendJson(res, 500, { ok: false, reason: 'config.json is not valid JSON - fix it and restart', presets: describePresets() });
        }
        return sendJson(res, 200, { ok: true, presets: describePresets() });
      }

      if (route === '/api/presets' && req.method === 'DELETE') {
        const body = await readBody(req);
        config.presets = config.presets.filter((p) => String(p.id) !== String(body.id));
        if (!configModule.save(config)) {
          return sendJson(res, 500, { ok: false, reason: 'config.json is not valid JSON - fix it and restart', presets: describePresets() });
        }
        return sendJson(res, 200, { ok: true, presets: describePresets() });
      }

      return sendJson(res, 404, { ok: false, reason: 'unknown endpoint' });
    } catch (err) {
      console.error('[server] ' + req.method + ' ' + route + ' -> ' + err.message);
      return sendJson(res, 500, { ok: false, reason: err.message });
    }
  });

  return { server, startPreset };
}

module.exports = { createServer, findDetectableTwin };
