'use strict';

const $ = (id) => document.getElementById(id);
const state = { presets: [], running: [], os: '', results: [], expanded: new Set() };

/* ---------------- helpers ---------------- */

async function api(path, options) {
  const res = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options));
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.reason) throw new Error(data.reason);
  return data;
}

let toastTimer = null;
function toast(message, kind) {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function iconEl(game) {
  const src = game.iconUrl
    || (game.icon ? 'https://cdn.discordapp.com/app-icons/' + game.id + '/' + game.icon + '.png?size=64' : null);
  if (src) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = src;
    img.onerror = () => img.replaceWith(fallbackIcon(game.name));
    return img;
  }
  return fallbackIcon(game.name);
}

function fallbackIcon(name) {
  const div = document.createElement('div');
  div.className = 'noicon';
  div.textContent = (name || '?').trim().charAt(0).toUpperCase();
  return div;
}

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' h ago';
  return Math.floor(hours / 24) + ' d ago';
}

function row(game, extras) {
  const el = document.createElement('div');
  el.className = 'row' + (extras.live ? ' live' : '');

  el.appendChild(iconEl(game));

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = game.name;
  if (game.custom) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'steam';
    tag.title = 'Added from Steam, not in Discord’s detectable list';
    name.appendChild(tag);
  }
  const exe = document.createElement('div');
  exe.className = 'exe';
  exe.textContent = extras.subtitle || '';
  info.append(name, exe);
  el.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'actions';
  (extras.actions || []).forEach((node) => actions.appendChild(node));
  el.appendChild(actions);
  return el;
}

function button(label, className, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn small ' + className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/* ---------------- actions ---------------- */

function currentDuration() {
  const value = Number($('duration').value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function refreshAll() {
  renderRunning();
  renderPresets();
  renderResults();
}

/** @param executable "all", an executable name, or undefined for the default one */
async function startGame(game, executable, durationMinutes) {
  try {
    const data = await api('/api/start', {
      method: 'POST',
      body: JSON.stringify({
        id: game.id,
        executable,
        durationMinutes: durationMinutes === undefined ? currentDuration() : durationMinutes
      })
    });
    state.running = data.running;
    refreshAll();

    // executables that were already running are skipped, not failures worth shouting about
    const failed = (data.results || []).filter((r) => !r.ok && !/already running/.test(r.reason || ''));
    const started = (data.sessions || []).length;
    toast(
      'Started ' + game.name + ' · ' + started + ' process' + (started === 1 ? '' : 'es')
        + (failed.length ? ' (' + failed.length + ' failed: ' + failed[0].reason + ')' : ''),
      failed.length ? 'error' : 'ok'
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Pass a session key to stop one executable, or {id} to stop every one of that game. */
async function stopGame(body) {
  try {
    const data = await api('/api/stop', { method: 'POST', body: JSON.stringify(body) });
    state.running = data.running;
    refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showSteamNote(text, forceInput) {
  $('steamNoteText').textContent = text;
  $('steamNote').hidden = false;
  const force = $('steamForce');
  force.hidden = !forceInput;
  force.onclick = forceInput ? () => addCustomGame(forceInput, true) : null;
}

function clearSteamNote() {
  $('steamNote').hidden = true;
  $('steamForce').hidden = true;
}

/** Look a game up on Steam when Discord's detectable list does not have it. */
async function addCustomGame(input, force) {
  const btn = $('steamAdd');
  if (!input) return;

  btn.disabled = true;
  btn.textContent = 'Looking up…';
  clearSteamNote();

  try {
    const data = await api('/api/custom', {
      method: 'POST',
      body: JSON.stringify({ input, force: Boolean(force) })
    });

    // Discord already knowing the game is the good outcome, not a failure: its entry is the
    // only one a quest counts, so open that instead of saving a copy that never gets detected.
    const target = data.added ? data.game : data.useInstead;

    if (data.added) {
      $('steamInput').value = '';
      toast('Added ' + target.name + ' from Steam', 'ok');
      showSteamNote('Saved to data/custom-games.json · '
        + target.executables.map((e) => e.name || e).join(', '));
    } else {
      toast(target.name + ' is already in Discord’s list — showing it below', 'ok');
      showSteamNote(target.name + ' is already in Discord’s list ('
        + target.executables.join(', ') + '), so it is ready to use as-is. '
        + 'A Steam copy would not count towards a quest.', input);
    }

    $('search').value = target.name;
    await loadState();
    await runSearch();
    state.expanded.add(target.id);
    renderResults();
  } catch (err) {
    toast(err.message, 'error');
    showSteamNote(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add';
  }
}

async function removeCustomGame(game) {
  try {
    await api('/api/custom', { method: 'DELETE', body: JSON.stringify({ id: game.id }) });
    toast('Removed ' + game.name, 'ok');
    await loadState();
    await runSearch();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function togglePreset(game, executable) {
  const saved = state.presets.some((p) => String(p.id) === String(game.id));
  try {
    const data = await api('/api/presets', {
      method: saved ? 'DELETE' : 'POST',
      body: JSON.stringify({
        id: game.id,
        // undefined lets the server store the first non-launcher executable. Never "all":
        // one process is all Discord needs, and a preset should start exactly one.
        executable,
        durationMinutes: currentDuration()
      })
    });
    state.presets = data.presets;
    refreshAll();
    toast(saved ? 'Removed from config.json' : 'Saved to config.json', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- rendering ---------------- */

function renderRunning() {
  const list = $('runningList');
  list.textContent = '';
  $('runningCount').textContent = state.running.length;
  $('stopAllBtn').hidden = state.running.length === 0;

  if (state.running.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No fake game running. Pick one below and press Start.';
    list.appendChild(p);
    return;
  }

  state.running.forEach((session) => {
    const timer = document.createElement('span');
    timer.className = 'timer';
    timer.dataset.startedAt = session.startedAt;
    timer.textContent = formatElapsed(session.elapsedSeconds);

    const subtitle = session.executable + '  ·  pid ' + session.pid
      + (session.durationMinutes ? '  ·  auto-stop ' + session.durationMinutes + ' min' : '');

    list.appendChild(row(session, {
      live: true,
      subtitle,
      actions: [timer, button('Stop', 'danger', () => stopGame({ key: session.key }))]
    }));
  });
}

function renderPresets() {
  const list = $('presetList');
  list.textContent = '';
  $('presetCount').textContent = state.presets.length;

  if (state.presets.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.innerHTML = 'No presets yet — press ☆ on a game to save it into <code>config.json</code>.';
    list.appendChild(p);
    return;
  }

  state.presets.forEach((preset) => {
    const sessions = runningFor(preset.id);
    // never let one odd preset blank the whole panel
    const executables = preset.executables || [];
    const actions = [];

    if (preset.missing) {
      const disabled = button('Not detectable', 'ghost', () => {});
      disabled.disabled = true;
      actions.push(disabled);
    } else if (sessions.length > 0) {
      actions.push(button('Stop' + (sessions.length > 1 ? ' all (' + sessions.length + ')' : ''), 'danger',
        () => stopGame({ id: preset.id })));
    } else {
      actions.push(button('Start', 'primary',
        () => startGame(preset, preset.executable, preset.durationMinutes)));
    }
    actions.push(button('★', 'ghost', () => togglePreset(preset)));

    const target = executables[0] || String(preset.executable || 'default executable');

    const subtitle = preset.missing
      ? 'id ' + preset.id + ' is not in the current game list'
      : 'config.json  ·  ' + target
        + (preset.durationMinutes ? '  ·  auto-stop ' + preset.durationMinutes + ' min' : '');

    list.appendChild(row(preset, { live: sessions.length > 0, subtitle, actions }));
  });
}

function runningFor(gameId, executable) {
  return state.running.filter((s) =>
    String(s.gameId) === String(gameId) && (executable === undefined || s.executable === executable));
}

/** The per-executable sub-rows shown under a game with more than one executable. */
function executableRows(game) {
  const wrap = document.createElement('div');
  wrap.className = 'exe-list';

  game.executables.forEach((exe) => {
    const session = runningFor(game.id, exe.name)[0];
    const item = document.createElement('div');
    item.className = 'exe-row' + (session ? ' live' : '');

    const label = document.createElement('div');
    label.className = 'exe-name';
    label.textContent = exe.name;
    if (exe.isLauncher) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'launcher';
      label.appendChild(tag);
    }

    const action = session
      ? button('Stop', 'danger', () => stopGame({ key: session.key }))
      : button('Start', 'ghost', () => startGame(game, exe.name));

    item.append(label, action);
    wrap.appendChild(item);
  });

  return wrap;
}

/** Render one game into the results list, plus its executable sub-rows when expanded. */
function appendResultRow(container, game) {
  const sessions = runningFor(game.id);
  const multi = game.executables.length > 1;
  const saved = state.presets.some((p) => String(p.id) === String(game.id));

  const star = document.createElement('button');
  star.className = 'star' + (saved ? ' on' : '');
  star.title = saved ? 'Remove from config.json' : 'Save to config.json';
  star.textContent = saved ? '★' : '☆';
  star.addEventListener('click', () => togglePreset(game));

  const actions = [star];

  if (game.custom) {
    const remove = button('✕', 'ghost', () => removeCustomGame(game));
    remove.title = 'Remove this game from custom-games.json';
    actions.push(remove);
  }

  // One process is enough for Discord to see the game, so the main button starts a single
  // executable - the per-executable list below is there when a different one is needed.
  if (sessions.length > 0) {
    actions.push(button(sessions.length > 1 ? 'Stop all (' + sessions.length + ')' : 'Stop', 'danger',
      () => stopGame({ id: game.id })));
  } else {
    actions.push(button('Start', 'primary', () => startGame(game, game.executables[0].name)));
  }

  const subtitle = multi
    ? game.executables.length + ' executables'
      + (sessions.length ? '  ·  ' + sessions.length + ' running' : '  ·  starts ' + game.executables[0].name)
    : game.executables[0].name;

  const el = row(game, { live: sessions.length > 0, subtitle, actions });

  if (multi) {
    const toggle = document.createElement('button');
    toggle.className = 'chevron';
    toggle.title = 'Show each executable';
    toggle.textContent = state.expanded.has(game.id) ? '▾' : '▸';
    toggle.addEventListener('click', () => {
      if (state.expanded.has(game.id)) state.expanded.delete(game.id);
      else state.expanded.add(game.id);
      renderResults();
    });
    el.insertBefore(toggle, el.firstChild);
  }

  container.appendChild(el);
  if (multi && state.expanded.has(game.id)) container.appendChild(executableRows(game));
}

/** Full rebuild. Keeps the scroll position so a Start/Stop does not throw the list around. */
function renderResults() {
  const container = $('results');
  const scroll = container.scrollTop;
  container.textContent = '';
  state.results.forEach((game) => appendResultRow(container, game));
  container.scrollTop = scroll;
}

function renderMeta(meta) {
  $('listMeta').textContent = meta.refreshing
    ? 'refreshing…'
    : meta.count + ' games · ' + meta.playableHere + ' for ' + state.os + ' · updated ' + timeAgo(meta.fetchedAt);
}

/* ---------------- data flow ---------------- */

let searchTimer = null;

const PAGE_SIZE = 100;
// `generation` invalidates pages still in flight when the query changes underneath them
const paging = { query: '', total: 0, loading: false, generation: 0, exhausted: false };

function fetchPage(query, offset) {
  return api('/api/games?limit=' + PAGE_SIZE + '&offset=' + offset + '&q=' + encodeURIComponent(query));
}

function updateHint() {
  const shown = state.results.length;
  if (paging.total === 0) {
    $('resultHint').textContent = paging.query ? 'No match' : '';
  } else if (shown < paging.total) {
    $('resultHint').textContent = 'Showing ' + shown + ' of ' + paging.total
      + (paging.loading ? ' — loading more…' : ' — scroll for more');
  } else {
    $('resultHint').textContent = paging.total + ' match' + (paging.total === 1 ? '' : 'es');
  }
}

/** Fresh search: replaces the list and scrolls back to the top. */
async function runSearch() {
  const query = $('search').value.trim();
  paging.generation += 1;
  paging.query = query;
  paging.exhausted = false;
  paging.loading = true;
  const generation = paging.generation;

  try {
    const data = await fetchPage(query, 0);
    if (generation !== paging.generation) return; // a newer search already started
    state.results = data.items;
    paging.total = data.total;
    renderResults();
    $('results').scrollTop = 0;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (generation === paging.generation) paging.loading = false;
  }

  updateHint();
  fillViewport();
}

/** Append the next page. Called by the scroll handler and after each page lands. */
async function loadMore() {
  if (paging.loading || paging.exhausted || state.results.length >= paging.total) return;
  paging.loading = true;
  updateHint();
  const generation = paging.generation;

  try {
    const data = await fetchPage(paging.query, state.results.length);
    if (generation !== paging.generation) return;

    if (data.items.length === 0) {
      paging.exhausted = true;
    } else {
      const container = $('results');
      state.results = state.results.concat(data.items);
      data.items.forEach((game) => appendResultRow(container, game));
      paging.total = data.total;
    }
  } catch (err) {
    paging.exhausted = true; // stop hammering a failing endpoint
    toast(err.message, 'error');
  } finally {
    if (generation === paging.generation) paging.loading = false;
  }

  updateHint();
  fillViewport();
}

/** With few or short rows the list may not scroll at all - keep filling until it does. */
function fillViewport() {
  const container = $('results');
  // clientHeight is 0 while the panel is hidden - filling then would fetch every page
  if (container.clientHeight > 0 && container.scrollHeight <= container.clientHeight + 40) loadMore();
}

async function loadState() {
  const data = await api('/api/state');
  state.os = data.os;
  state.presets = data.presets;
  state.running = data.running;
  $('platform').textContent = data.os;
  $('duration').value = data.settings.defaultDurationMinutes || 0;
  renderMeta(data.games);
  renderRunning();
  renderPresets();
  return data;
}

/* ---------------- wiring ---------------- */

$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 180);
});

$('results').addEventListener('scroll', () => {
  const el = $('results');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) loadMore();
});

$('steamAdd').addEventListener('click', () => addCustomGame($('steamInput').value.trim()));
$('steamInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addCustomGame($('steamInput').value.trim());
});

$('refreshBtn').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  $('listMeta').textContent = 'refreshing…';
  try {
    const data = await api('/api/refresh', { method: 'POST' });
    renderMeta(data.games);
    await runSearch();
    toast(data.ok ? 'Game list updated (' + data.count + ' games)' : data.reason, data.ok ? 'ok' : 'error');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('stopAllBtn').addEventListener('click', async () => {
  const data = await api('/api/stop-all', { method: 'POST' });
  state.running = data.running;
  renderRunning();
  renderResults();
  renderPresets();
});


// live clock for the running rows
setInterval(() => {
  document.querySelectorAll('.timer').forEach((el) => {
    const started = Number(el.dataset.startedAt);
    if (started) el.textContent = formatElapsed(Math.floor((Date.now() - started) / 1000));
  });
}, 1000);

// keep the panel in sync with the server (background refresh, auto-stop timers, CLI usage)
setInterval(async () => {
  try {
    const data = await api('/api/state');
    const changed = JSON.stringify(data.running.map((s) => s.pid)) !== JSON.stringify(state.running.map((s) => s.pid));
    state.running = data.running;
    state.presets = data.presets;
    renderMeta(data.games);
    if (changed) {
      renderRunning();
      renderResults();
      renderPresets();
    }
  } catch (err) { /* server restarting */ }
}, 5000);

(async function init() {
  try {
    await loadState();
    await runSearch();
  } catch (err) {
    toast('Cannot reach the local server: ' + err.message, 'error');
  }
})();
