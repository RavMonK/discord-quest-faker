'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const DEFAULTS = {
  // HTTP UI
  port: 5011,
  host: '127.0.0.1',
  openBrowser: true,

  // game list
  apiUrl: 'https://discord.com/api/v10/applications/detectable',
  gamesFile: 'data/games.json',
  customGamesFile: 'data/custom-games.json',
  refreshOnStart: true,
  refreshIntervalMinutes: 720,

  // fake process runner
  runtimeDir: 'data/runtime',
  defaultDurationMinutes: 0, // 0 = run until stopped
  maxConcurrent: 12,

  // one-click list shown at the top of the UI.
  // each item: { "id": "<application id>", "name": "<label>", "executable": "all", "durationMinutes": 0 }
  presets: [],

  // games played one after another, each stopping when its own timer runs out.
  // each item: { "id": "<application id>", "name": "<label>", "executable": "<exe>", "durationMinutes": 15 }
  queue: [],
  // the gap before the next game starts, drawn fresh for every gap so the run has no rhythm
  queueDelayMinSeconds: 30,
  queueDelayMaxSeconds: 70,

  // start every preset automatically when the program launches
  autoStartPresets: false
};

function deepMerge(base, override) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function writeFile(values) {
  const ordered = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (values[key] !== undefined) ordered[key] = values[key];
  }
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  return ordered;
}

function load() {
  let userConfig = {};
  let readable = true;

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      // Editors on Windows happily save JSON with a UTF-8 BOM, which JSON.parse rejects.
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
      userConfig = raw.trim() ? JSON.parse(raw) : {};
    } catch (err) {
      readable = false;
      console.error(`[config] config.json is not valid JSON (${err.message})`);
      console.error('[config] running with default settings - the file is left untouched, fix it and restart');
    }
  } else {
    writeFile(DEFAULTS);
    console.log(`[config] created ${CONFIG_PATH}`);
  }

  const merged = deepMerge(DEFAULTS, userConfig);
  merged.root = ROOT;
  merged.configPath = CONFIG_PATH;
  merged.gamesPath = path.resolve(ROOT, merged.gamesFile);
  merged.customPath = path.resolve(ROOT, merged.customGamesFile);
  merged.runtimePath = path.resolve(ROOT, merged.runtimeDir);
  // Snapshot of what belongs in the file, so command line overrides (--port, --headless)
  // never leak into config.json when the UI saves a preset.
  Object.defineProperty(merged, 'fileState', {
    value: deepMerge(DEFAULTS, userConfig),
    enumerable: false,
    writable: true
  });
  Object.defineProperty(merged, 'readable', { value: readable, enumerable: false });
  return merged;
}

/** Only settings the UI can change are written back; everything else keeps its on-disk value. */
const EDITABLE_KEYS = ['presets', 'queue', 'queueDelayMinSeconds', 'queueDelayMaxSeconds',
  'autoStartPresets', 'defaultDurationMinutes', 'maxConcurrent'];

function save(config) {
  if (config.readable === false) {
    // Never overwrite a file we failed to parse - the user would lose their settings.
    console.error('[config] not saving: config.json could not be parsed on startup');
    return null;
  }
  const persisted = config.fileState || deepMerge(DEFAULTS, {});
  for (const key of EDITABLE_KEYS) {
    if (config[key] !== undefined) persisted[key] = config[key];
  }
  return writeFile(persisted);
}

module.exports = { load, save, DEFAULTS, CONFIG_PATH, ROOT };
