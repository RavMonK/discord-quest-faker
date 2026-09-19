'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'src', 'index.js');

/**
 * parseArgs() lives inside src/index.js and is not exported, so the only honest way to test
 * the CLI's argument handling is to spawn the binary. That is safe for --help only: main()
 * prints the help and returns before config.json is read, the game list is loaded, or the
 * runtime directory is touched. Every other mode (--list included) would read the user's real
 * config.json and data/games.json, and an unknown flag on its own would start the server -
 * so those are not spawned here. (Exporting parseArgs from src/index.js would make it unit
 * testable without a child process.)
 */
function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 15000
  });
  assert.equal(result.error, undefined); // e.g. the timeout above firing
  return result;
}

test('CLI: --help prints the usage and exits 0', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: node src\/index\.js/);
  assert.match(result.stdout, /--list/);
  assert.equal(result.stderr, '');
});

test('CLI: an unknown flag does not stop other flags from being parsed', () => {
  // --bogus on its own would fall through to starting the control panel, so it is only
  // spawned alongside --help: reaching the help text proves the unknown flag was collected
  // quietly instead of aborting the parse.
  const result = run(['--bogus', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

test('CLI: --help wins even when a value-taking flag precedes it', () => {
  // "--port 8080 --help": parseArgs must consume 8080 as the port's value, not mistake the
  // bare number for a positional, and still honour --help afterwards.
  const result = run(['--port', '8080', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});
