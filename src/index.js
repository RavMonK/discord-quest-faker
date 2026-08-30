#!/usr/bin/env node
'use strict';

const { exec, execSync } = require('child_process');
const readline = require('readline');
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

/* ---------------- the control panel port ---------------- */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** listen() with the callback/'error' pair folded into one promise, so a retry is easy. */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Whoever is listening on `port`, as { pid, name } - or null when nothing can be resolved. */
function portOwner(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', windowsHide: true });
      const row = out.split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        // TCP  127.0.0.1:5011  0.0.0.0:0  LISTENING  1234   - the address can also be [::]:5011
        .find((parts) => parts[0] === 'TCP' && parts[3] === 'LISTENING'
          && parts[1].endsWith(':' + port));
      if (!row) return null;
      return { pid: Number(row[4]), name: processName(Number(row[4])) };
    }

    const pid = Number(execSync('lsof -nP -iTCP:' + port + ' -sTCP:LISTEN -t', { encoding: 'utf8' })
      .split(/\s+/)[0]);
    return pid ? { pid, name: processName(pid) } : null;
  } catch (err) {
    return null; // netstat/lsof missing or nothing listening
  }
}

function processName(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "PID eq ' + pid + '" /NH /FO CSV',
        { encoding: 'utf8', windowsHide: true });
      const match = out.match(/^"([^"]+)"/m);
      return match ? match[1] : '';
    }
    return execSync('ps -p ' + pid + ' -o comm=', { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function killPid(pid) {
  try {
    // /T so the placeholders a leftover panel spawned go with it - they are its children
    if (process.platform === 'win32') {
      execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err.message).split('\n')[0] };
  }
}

/**
 * A busy port is nearly always a copy of this panel left behind by a crash or a second window,
 * so name the process and offer to kill it instead of making the user hunt the pid down.
 * Returns true only when the port really is free again.
 */
async function offerToFreePort(port) {
  const owner = portOwner(port);
  const hint = '        change "port" in config.json, or run with --port 8080';

  console.error('\n[server] port ' + port + ' is already in use'
    + (owner ? ' by ' + (owner.name || 'an unknown process') + ' (pid ' + owner.pid + ')' : ''));

  if (!owner) {
    console.error('        could not work out which process holds it');
    console.error(hint);
    return false;
  }
  if (!process.stdin.isTTY) {
    // --headless from a script: never kill something nobody agreed to kill
    console.error('        not running in a terminal, so nothing was killed - kill pid '
      + owner.pid + ' yourself');
    console.error(hint);
    return false;
  }

  const answer = await ask('        kill pid ' + owner.pid + ' and take the port? [y/N] ');
  if (answer !== 'y' && answer !== 'yes') {
    console.error('        left it running');
    console.error(hint);
    return false;
  }

  const killed = killPid(owner.pid);
  if (!killed.ok) {
    console.error('        could not kill pid ' + owner.pid + ': ' + killed.reason);
    console.error(hint);
    return false;
  }

  // the socket needs a moment to come back after the process goes away
  for (let i = 0; i < 10 && portOwner(port); i += 1) await delay(200);
  console.log('        killed pid ' + owner.pid + ' - taking port ' + port + '\n');
  return true;
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

  try {
    await listen(server, config.port, config.host);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') {
      console.error('[server] ' + err.message);
      process.exit(1);
    }
    if (!await offerToFreePort(config.port)) process.exit(1);
    try {
      await listen(server, config.port, config.host);
    } catch (retryErr) {
      console.error('[server] port ' + config.port + ' is still busy (' + retryErr.code + ')');
      process.exit(1);
    }
  }

  server.on('error', (err) => console.error('[server] ' + err.message));

  const url = 'http://' + config.host + ':' + config.port;
  console.log('');
  console.log('  Discord Quest Faker');
  console.log('  control panel : ' + url);
  console.log('  platform      : ' + OS_KEY);
  console.log('  game list     : ' + config.gamesFile + ' (' + store.games.length + ' cached)');
  console.log('');
  if (config.openBrowser) openBrowser(url);

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
