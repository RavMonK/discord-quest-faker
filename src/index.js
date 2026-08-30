#!/usr/bin/env node
'use strict';

const { exec } = require('child_process');
const configModule = require('./config');
const { GameStore, OS_KEY } = require('./games');
const { Spoofer } = require('./spoof');
const { createServer, findDetectableTwin } = require('./server');
const steam = require('./steam');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [flag, inlineValue] = token.slice(2).split('=');
    const next = argv[i + 1];
    if (inlineValue !== undefined) {
      args[flag] = inlineValue;
    } else if (next && !next.startsWith('--')) {
      args[flag] = next;
      i += 1;
    } else {
      args[flag] = true;
    }
  }
  return args;
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'start "" "' + url + '"'
    : process.platform === 'darwin' ? 'open "' + url + '"'
    : 'xdg-open "' + url + '"';
  exec(command, { windowsHide: true }, (err) => {
    if (err) console.log('[ui] open ' + url + ' in your browser');
  });
}

function printHelp() {
  console.log([
    '',
    'discord-quest-faker - fake a running game so Discord quests tick along',
    '',
    'Usage: node src/index.js [options]',
    '',
    '  (no options)          start the control panel and open it in the browser',
    '  --headless            start the control panel without opening a browser',
    '  --port <n>            override the port from config.json',
    '  --refresh             just refresh data/games.json and exit',
    '  --add-steam <id|url>  add a game missing from Discord list, from its Steam app config',
    '  --list [query]        print matching games for this OS and exit',
    '  --start <name|id>     start a game from the command line (Ctrl+C to stop)',
    '  --exe all|<name>|<n>  which executable(s) of that game to run (default: the first one)',
    '  --duration <minutes>  stop automatically after N minutes (with --start)',
    '  --presets             start every preset from config.json on launch',
    '  --help                show this help',
    ''
  ].join('\n'));
}

/**
 * A preset starts exactly one executable. Earlier versions saved "all" from the star button,
 * which turned one preset into several processes - rewrite those to the executable they would
 * have used anyway.
 */
function normalizePresets(config, store) {
  let changed = false;

  config.presets = config.presets.map((preset) => {
    if (preset.executable !== 'all') return preset;
    const game = store.resolve(preset.id || preset.name);
    const first = game ? Spoofer.candidates(game)[0] : null;
    if (!first) return preset;

    changed = true;
    console.log('[config] preset "' + (preset.name || preset.id) + '": "all" -> ' + first.name);
    return Object.assign({}, preset, { executable: first.name });
  });

  if (changed) configModule.save(config);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = configModule.load();
  if (args.port) config.port = Number(args.port);
  if (args.headless) config.openBrowser = false;

  const store = new GameStore(config);
  const spoofer = new Spoofer(config);
  normalizePresets(config, store);

  const shutdown = (signal) => {
    const stopped = spoofer.stopAll(true);
    if (stopped) console.log('\n[exit] stopped ' + stopped + ' fake game(s) (' + signal + ')');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
  process.on('exit', () => spoofer.stopAll(true));

  // --- one-shot CLI modes -------------------------------------------------
  if (args.refresh) {
    const result = await store.refresh();
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (args['add-steam']) {
    try {
      const game = await steam.fetchGame(args['add-steam']);
      const known = args.force ? null : findDetectableTwin(store.detectable, game);

      if (known) {
        // Discord's own executables are the ones that count - Steam's can be different.
        console.log('\n[steam] "' + game.name + '" is already in Discord\'s list as "' + known.name + '"');
        console.log('        Steam lists:   ' + game.executables.map((e) => e.name).join(', '));
        console.log('        Discord wants: ' + Spoofer.candidates(known).map((e) => e.name).join(', '));
        Spoofer.candidates(known).forEach((exe, i) => console.log('   [' + i + '] ' + exe.name));
        console.log('\nStart it with: node src/index.js --start "' + known.name + '" --exe <index or name>');
        console.log('(pass --force to save the Steam entry anyway)\n');
        return;
      }

      store.addCustom(game);
      console.log('\n[steam] added "' + game.name + '" as ' + game.id);
      Spoofer.candidates(game).forEach((exe, i) => console.log('   [' + i + '] ' + exe.name));
      console.log('\nStart it with: node src/index.js --start "' + game.name + '"\n');
    } catch (err) {
      console.error('[steam] ' + err.message);
      process.exitCode = 1;
    }
    return;
  }

  if (args.list !== undefined) {
    if (store.games.length === 0) await store.refresh();
    const query = typeof args.list === 'string' ? args.list : '';
    const { total, items } = store.search(query, { limit: 40 });
    console.log('\n' + total + ' game(s) detectable on ' + OS_KEY + (query ? ' matching "' + query + '"' : '') + ':\n');    for (const game of items) {
      const executables = Spoofer.candidates(game);
      console.log('  ' + game.name.padEnd(44) + game.id);
      // the index shown here is what --exe <n> expects
      executables.forEach((exe, i) => {
        console.log('      [' + i + '] ' + exe.name + (exe.isLauncher ? '  (launcher)' : ''));
      });
    }
    if (total > items.length) console.log('\n  ... and ' + (total - items.length) + ' more');
    console.log('');
    return;
  }

  if (args.start) {
    if (store.games.length === 0) await store.refresh();
    const game = store.resolve(args.start);
    if (!game) {
      console.error('[cli] no game matched "' + args.start + '" - try --list ' + args.start);
      process.exitCode = 1;
      return;
    }
    // --exe all | --exe "lolex.exe" | --exe 2 ; default = first non-launcher executable
    const result = spoofer.start(game, {
      executable: args.exe === true ? 'all' : args.exe,
      durationMinutes: args.duration ? Number(args.duration) : undefined
    });
    if (!result.ok) {
      console.error('[cli] ' + result.reason);
      process.exitCode = 1;
      return;
    }
    result.results.filter((r) => !r.ok).forEach((r) => console.error('[cli] ' + r.executable + ': ' + r.reason));
    console.log('[cli] Discord should now show you playing "' + game.name + '" ('
      + result.sessions.map((s) => s.executable).join(', ') + '). Press Ctrl+C to stop.');
    // Hold the process open until the fake game stops (Ctrl+C or the --duration timer).
    const hold = setInterval(() => {
      if (spoofer.list().length === 0) {
        clearInterval(hold);
        console.log('[cli] finished.');
      }
    }, 1000);
    return;
  }

  // --- control panel ------------------------------------------------------
  const { server, startPreset } = createServer({ config, store, spoofer });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[server] port ' + config.port + ' is already in use - change "port" in config.json or pass --port');
    } else {
      console.error('[server] ' + err.message);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const url = 'http://' + config.host + ':' + config.port;
    console.log('');
    console.log('  Discord Quest Faker');
    console.log('  control panel : ' + url);
    console.log('  platform      : ' + OS_KEY);
    console.log('  game list     : ' + config.gamesFile + ' (' + store.games.length + ' cached)');
    console.log('');
    if (config.openBrowser) openBrowser(url);
  });

  // Refresh the json list in the background so the UI is usable immediately.
  const refreshAndMaybeAutoStart = async () => {
    await store.refresh();
    if ((args.presets || config.autoStartPresets) && config.presets.length > 0) {
      for (const preset of config.presets) {
        const result = startPreset(preset);
        if (!result.ok) console.error('[preset] ' + (preset.name || preset.id) + ': ' + result.reason);
      }
    }
  };

  if (config.refreshOnStart) {
    refreshAndMaybeAutoStart();
  } else if ((args.presets || config.autoStartPresets) && config.presets.length > 0) {
    config.presets.forEach(startPreset);
  }

  if (config.refreshIntervalMinutes > 0) {
    const timer = setInterval(() => store.refresh(), config.refreshIntervalMinutes * 60000);
    if (timer.unref) timer.unref();
  }
}

main().catch((err) => {
  console.error('[fatal] ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
