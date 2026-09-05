"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  presets: [],
  running: [],
  os: "",
  results: [],
  queue: {
    running: false,
    items: [],
    delay: { min: 30, max: 70 },
    nextStartAt: null,
    nextUid: null,
  },
  // the two panels expand independently, so one set each
  expanded: new Set(),
  expandedPresets: new Set(),
};

/* ---------------- helpers ---------------- */

let sessionToken = null;
function getSessionToken() {
  if (!sessionToken) {
    sessionToken = fetch("/api/session", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Cannot establish a local API session");
        const data = await res.json();
        return data.token;
      })
      .catch((err) => {
        sessionToken = null;
        throw err;
      });
  }
  return sessionToken;
}

async function api(path, options, retry = true) {
  const token = await getSessionToken();
  const res = await fetch(
    path,
    Object.assign({}, options, {
      headers: Object.assign({}, options && options.headers, {
        "Content-Type": "application/json",
        "X-DQF-Token": token,
      }),
    }),
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === "invalid_token" && retry) {
    sessionToken = null; // the server restarted; the rejected request had no side effects
    return api(path, options, false);
  }
  if (!res.ok && data.reason) throw new Error(data.reason);
  return data;
}

let toastTimer = null;
function toast(message, kind) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast" + (kind ? " " + kind : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

function iconEl(game) {
  const src =
    game.iconUrl ||
    (game.icon
      ? "https://cdn.discordapp.com/app-icons/" +
        game.id +
        "/" +
        game.icon +
        ".png?size=64"
      : null);
  if (src) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = src;
    img.onerror = () => img.replaceWith(fallbackIcon(game.name));
    return img;
  }
  return fallbackIcon(game.name);
}

function fallbackIcon(name) {
  const div = document.createElement("div");
  div.className = "noicon";
  div.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return div;
}

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return (h > 0 ? h + ":" : "") + pad(m) + ":" + pad(s);
}

function timeAgo(iso) {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " h ago";
  return Math.floor(hours / 24) + " d ago";
}

function row(game, extras) {
  const el = document.createElement("div");
  el.className = "row" + (extras.live ? " live" : "");

  el.appendChild(iconEl(game));

  const info = document.createElement("div");
  info.className = "info";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = game.name;
  if (game.custom) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "steam";
    tag.title = "Added from Steam, not in Discord’s detectable list";
    name.appendChild(tag);
  }
  const exe = document.createElement("div");
  exe.className = "exe";
  exe.textContent = extras.subtitle || "";
  info.append(name, exe);
  el.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "actions";
  (extras.actions || []).forEach((node) => actions.appendChild(node));
  el.appendChild(actions);
  return el;
}

/**
 * A row action button. Disabled for the duration of its click handler so a slow start/stop
 * cannot be double-fired by an impatient extra click - the row is re-rendered on completion
 * anyway, so re-enabling a stale, detached button is harmless.
 */
function button(label, className, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn small " + className;
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    btn.disabled = true;
    Promise.resolve(onClick()).finally(() => {
      btn.disabled = false;
    });
  });
  return btn;
}

/**
 * The expand control for a game with several executables. The bare 16px chevron was easy to
 * miss and fiddly to hit, so this is a real button and the row's own name/subtitle toggles it
 * too - the buttons on the right keep their own clicks.
 */
function addExpander(el, key, expandedSet, rerender) {
  const open = expandedSet.has(key);

  const toggle = () => {
    if (expandedSet.has(key)) expandedSet.delete(key);
    else expandedSet.add(key);
    rerender();
  };

  const btn = document.createElement("button");
  btn.className = "chevron" + (open ? " open" : "");
  btn.title = open ? "Hide the executables" : "Show each executable";
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = "▸";
  btn.addEventListener("click", toggle);

  el.classList.add("expandable");
  el.insertBefore(btn, el.firstChild);
  el.querySelector(".info").addEventListener("click", toggle);
}

/* ---------------- actions ---------------- */

function currentDuration() {
  const value = Number($("duration").value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function refreshAll() {
  renderRunning();
  renderQueue();
  renderPresets();
  renderResults();
}

/** @param executable "all", an executable name, or undefined for the default one */
async function startGame(game, executable, durationMinutes) {
  try {
    const data = await api("/api/start", {
      method: "POST",
      body: JSON.stringify({
        id: game.id,
        executable,
        durationMinutes:
          durationMinutes === undefined ? currentDuration() : durationMinutes,
      }),
    });
    state.running = data.running;
    refreshAll();

    // executables that were already running are skipped, not failures worth shouting about
    const failed = (data.results || []).filter(
      (r) => !r.ok && !/already running/.test(r.reason || ""),
    );
    const started = (data.sessions || []).length;
    toast(
      "Started " +
        game.name +
        " · " +
        started +
        " process" +
        (started === 1 ? "" : "es") +
        (failed.length
          ? " (" + failed.length + " failed: " + failed[0].reason + ")"
          : ""),
      failed.length ? "error" : "ok",
    );
  } catch (err) {
    toast(err.message, "error");
  }
}

/** Pass a session key to stop one executable, or {id} to stop every one of that game. */
async function stopGame(body) {
  try {
    const data = await api("/api/stop", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.running = data.running;
    refreshAll();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------------- the queue ---------------- */

/**
 * One game at a time, each stopping when its own timer runs out - so an entry without an
 * auto-stop time would hold the queue there until someone presses Stop or Skip. The duration
 * box at the top of the Games panel is what a new entry starts with.
 */
async function queueAdd(game, executable, durationMinutes) {
  const minutes =
    durationMinutes === undefined ? currentDuration() : durationMinutes;
  try {
    const data = await api("/api/queue", {
      method: "POST",
      body: JSON.stringify({
        id: game.id,
        executable,
        durationMinutes: minutes,
      }),
    });
    state.queue = data.queue;
    refreshAll();
    toast(
      minutes > 0
        ? "Queued " + game.name + " for " + minutes + " min"
        : "Queued " +
            game.name +
            " - give it a time so the queue can move on by itself",
      minutes > 0 ? "ok" : "error",
    );
  } catch (err) {
    toast(err.message, "error");
  }
}

/**
 * The ＋ that puts a game into the queue. Every panel builds it through this, so the button
 * looks the same and sits in the same place wherever a game is listed - it used to be a bare
 * glyph on game rows, a full-size ghost button on the executable sub-rows, and missing
 * altogether from presets.
 * @param durationMinutes what the entry should play for; undefined = the duration box
 */
function queueAddButton(game, executable, durationMinutes, title) {
  const btn = document.createElement("button");
  btn.className = "queue-add";
  btn.textContent = "\uff0b";
  btn.title =
    title ||
    "Add to the queue (plays for the time in the box above, then the next one starts)";
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    btn.disabled = true;
    Promise.resolve(queueAdd(game, executable, durationMinutes)).finally(() => {
      btn.disabled = false;
    });
  });
  return btn;
}

/** Every queue endpoint answers with the whole queue, so one helper covers all of them. */
async function queueCall(path, options) {
  try {
    const data = await api(path, options);
    if (data.queue) state.queue = data.queue;
    if (data.running) state.running = data.running;
    refreshAll();
    return data;
  } catch (err) {
    toast(err.message, "error");
    return null;
  }
}

const queueRemove = (uid) =>
  queueCall("/api/queue", { method: "DELETE", body: JSON.stringify({ uid }) });
const queueMove = (uid, direction) =>
  queueCall("/api/queue/move", {
    method: "POST",
    body: JSON.stringify({ uid, direction }),
  });
const queueSetDuration = (uid, durationMinutes) =>
  queueCall("/api/queue", {
    method: "PATCH",
    body: JSON.stringify({ uid, durationMinutes }),
  });

function queueSaveDelay() {
  return queueCall("/api/queue/settings", {
    method: "POST",
    body: JSON.stringify({
      minSeconds: Number($("queueDelayMin").value),
      maxSeconds: Number($("queueDelayMax").value),
    }),
  });
}

function showSteamNote(text, forceInput) {
  $("steamNoteText").textContent = text;
  $("steamNote").hidden = false;
  const force = $("steamForce");
  force.hidden = !forceInput;
  force.onclick = forceInput ? () => addCustomGame(forceInput, true) : null;
}

function clearSteamNote() {
  $("steamNote").hidden = true;
  $("steamForce").hidden = true;
}

/** Look a game up on Steam when Discord's detectable list does not have it. */
async function addCustomGame(input, force) {
  const btn = $("steamAdd");
  if (!input) return;

  btn.disabled = true;
  btn.textContent = "Looking up…";
  clearSteamNote();

  try {
    const data = await api("/api/custom", {
      method: "POST",
      body: JSON.stringify({ input, force: Boolean(force) }),
    });

    // Discord already knowing the game is the good outcome, not a failure: its entry is the
    // only one a quest counts, so open that instead of saving a copy that never gets detected.
    const target = data.added ? data.game : data.useInstead;

    if (data.added) {
      $("steamInput").value = "";
      toast("Added " + target.name + " from Steam", "ok");
      showSteamNote(
        "Saved to data/custom-games.json · " +
          target.executables.map((e) => e.name || e).join(", "),
      );
    } else {
      toast(
        target.name + " is already in Discord’s list — showing it below",
        "ok",
      );
      showSteamNote(
        target.name +
          " is already in Discord’s list (" +
          target.executables.join(", ") +
          "), so it is ready to use as-is. " +
          "A Steam copy would not count towards a quest.",
        input,
      );
    }

    $("search").value = target.name;
    await loadState();
    await runSearch();
    state.expanded.add(target.id);
    renderResults();
  } catch (err) {
    toast(err.message, "error");
    showSteamNote(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Add";
  }
}

async function removeCustomGame(game) {
  try {
    await api("/api/custom", {
      method: "DELETE",
      body: JSON.stringify({ id: game.id }),
    });
    toast("Removed " + game.name, "ok");
    await loadState();
    await runSearch();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function togglePreset(game, executable) {
  const saved = state.presets.some((p) => String(p.id) === String(game.id));
  try {
    const data = await api("/api/presets", {
      method: saved ? "DELETE" : "POST",
      body: JSON.stringify({
        id: game.id,
        // undefined lets the server store the first non-launcher executable. Never "all":
        // one process is all Discord needs, and a preset should start exactly one.
        executable,
        durationMinutes: currentDuration(),
      }),
    });
    state.presets = data.presets;
    refreshAll();
    toast(saved ? "Removed from config.json" : "Saved to config.json", "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------------- rendering ---------------- */

function renderRunning() {
  const list = $("runningList");
  list.textContent = "";
  $("runningCount").textContent = state.running.length;
  $("stopAllBtn").hidden = state.running.length === 0;

  if (state.running.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No fake game running. Pick one below and press Start.";
    list.appendChild(p);
    return;
  }

  state.running.forEach((session) => {
    const timer = document.createElement("span");
    timer.className = "timer";
    timer.dataset.startedAt = session.startedAt;
    timer.textContent = formatElapsed(session.elapsedSeconds);

    const subtitle =
      session.executable +
      "  ·  pid " +
      session.pid +
      (session.durationMinutes
        ? "  ·  auto-stop " + session.durationMinutes + " min"
        : "");

    list.appendChild(
      row(session, {
        live: true,
        subtitle,
        actions: [
          timer,
          button("Stop", "danger", () => stopGame({ key: session.key })),
        ],
      }),
    );
  });
}

/** Seconds until the next entry starts, or null when nothing is waiting on the clock. */
function queueCountdown() {
  if (!state.queue.running || !state.queue.nextStartAt) return null;
  return Math.max(0, Math.round((state.queue.nextStartAt - Date.now()) / 1000));
}

/**
 * The one line above the list. It is the only place that says what the queue is doing right
 * now, so it has to cover all three states: idle, playing something, waiting out a gap.
 */
function renderQueueStatus() {
  const el = $("queueStatus");
  const queue = state.queue;
  const current = queue.items.find((i) => i.uid === queue.currentUid);
  const waiting = queue.items.find((i) => i.uid === queue.nextUid);
  const seconds = queueCountdown();
  const range = queue.delay.min + "-" + queue.delay.max + " s";

  if (!queue.running) {
    el.hidden = queue.items.length === 0;
    const pending = queue.items.filter((i) => i.status === "pending").length;
    el.textContent =
      queue.items.length === 0
        ? ""
        : "Idle - " +
          queue.items.length +
          " entr" +
          (queue.items.length === 1 ? "y" : "ies") +
          (pending < queue.items.length
            ? ", " + pending + " still pending"
            : "") +
          " - gap " +
          range;
    return;
  }

  el.hidden = false;
  if (seconds !== null) {
    el.textContent =
      "Next up: " +
      (waiting ? waiting.name : "the next entry") +
      " in " +
      seconds +
      " s (drawn from " +
      range +
      ")";
  } else if (current) {
    el.textContent =
      "Playing " +
      current.name +
      (current.effectiveDurationMinutes > 0
        ? " - stops after " +
          current.effectiveDurationMinutes +
          " min, then a " +
          range +
          " gap"
        : " - no auto-stop time, so the queue waits here (press Skip to move on)");
  } else {
    el.textContent = "Starting the next entry...";
  }
}

const QUEUE_STATUS_LABEL = {
  pending: "waiting",
  running: "playing",
  done: "done",
  failed: "failed",
  skipped: "skipped",
  stopped: "stopped",
};

function renderQueue() {
  const list = $("queueList");
  const queue = state.queue;
  list.textContent = "";
  $("queueCount").textContent = queue.items.length;

  const startBtn = $("queueStartBtn");
  startBtn.textContent = queue.running ? "Stop queue" : "Start queue";
  startBtn.className = "btn small " + (queue.running ? "danger" : "primary");
  startBtn.disabled = queue.items.length === 0;
  $("queueSkipBtn").hidden = !queue.running;
  $("queueClearBtn").hidden = queue.items.length === 0;
  renderQueueStatus();

  if (queue.items.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      "Queue is empty - press the + on a game to line it up. Each entry plays for its " +
      "own auto-stop time, then the next one starts after a random gap.";
    list.appendChild(p);
    return;
  }

  queue.items.forEach((item, index) => {
    const el = document.createElement("div");
    el.className =
      "queue-row status-" +
      item.status +
      (item.uid === queue.currentUid ? " live" : "") +
      (queue.running && item.uid === queue.nextUid ? " next" : "");

    const position = document.createElement("span");
    position.className = "queue-pos";
    position.textContent = index + 1;
    el.append(position, iconEl(item));

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.name;
    const sub = document.createElement("div");
    sub.className = "exe";
    sub.textContent =
      (item.missing
        ? "id " + item.id + " is not in the current game list"
        : item.executable) +
      "  \u00b7  " +
      (QUEUE_STATUS_LABEL[item.status] || item.status) +
      (item.status === "failed" && item.reason ? " (" + item.reason + ")" : "");
    info.append(name, sub);
    el.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "actions";

    // the per-entry auto-stop time - this is what decides when the queue moves on
    const minutes = document.createElement("input");
    minutes.type = "number";
    minutes.min = "0";
    minutes.step = "5";
    minutes.className = "queue-minutes";
    minutes.value = String(item.durationMinutes || 0);
    minutes.title =
      item.durationMinutes > 0
        ? "Plays for " +
          item.durationMinutes +
          " minutes, then the next entry starts"
        : "No auto-stop time - the queue will wait on this entry";
    minutes.addEventListener("change", () =>
      queueSetDuration(item.uid, Number(minutes.value)),
    );
    const unit = document.createElement("span");
    unit.className = "queue-unit";
    unit.textContent = "min";

    const up = button("\u2191", "ghost", () => queueMove(item.uid, "up"));
    up.title = "Move up";
    up.disabled = index === 0;
    const down = button("\u2193", "ghost", () => queueMove(item.uid, "down"));
    down.title = "Move down";
    down.disabled = index === queue.items.length - 1;
    const remove = button("\u2715", "danger ghost", () =>
      queueRemove(item.uid),
    );
    remove.title = "Remove from the queue";

    actions.append(minutes, unit, up, down, remove);
    el.appendChild(actions);
    list.appendChild(el);
  });
}

function renderPresets() {
  const list = $("presetList");
  list.textContent = "";
  $("presetCount").textContent = state.presets.length;

  if (state.presets.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.innerHTML =
      "No presets yet — press ☆ on a game to save it into <code>config.json</code>.";
    list.appendChild(p);
    return;
  }

  state.presets.forEach((preset) => {
    const sessions = runningFor(preset.id);
    // never let one odd preset blank the whole panel
    const executables = preset.executables || [];
    const multi = executables.length > 1;
    const actions = [];

    if (preset.missing) {
      const disabled = button("Not detectable", "ghost", () => {});
      disabled.disabled = true;
      actions.push(disabled);
    } else if (sessions.length > 0) {
      actions.push(
        button(
          "Stop" +
            (sessions.length > 1 ? " all (" + sessions.length + ")" : ""),
          "danger",
          () => stopGame({ id: preset.id }),
        ),
      );
    } else {
      actions.push(
        button("Start", "primary", () =>
          startGame(
            preset,
            preset.executable,
            preset.durationMinutes || undefined,
          ),
        ),
      );
    }

    // the preset's own auto-stop time is what the queue entry should use, falling back to the
    // duration box when the preset does not carry one
    const queueBtn = queueAddButton(
      preset,
      preset.executable,
      preset.durationMinutes || undefined,
      "Add this preset to the queue",
    );
    queueBtn.disabled = Boolean(preset.missing);
    actions.unshift(queueBtn);
    // a star here reads as "saved", not as "delete" - name the action instead
    const remove = button("Remove", "danger ghost", () => togglePreset(preset));
    remove.title = "Remove this preset from config.json";
    actions.push(remove);

    const target = String(
      preset.executable ||
        (executables[0] && executables[0].name) ||
        "default executable",
    );

    const subtitle = preset.missing
      ? "id " + preset.id + " is not in the current game list"
      : "config.json  ·  " +
        (multi
          ? executables.length +
            " executables  ·  " +
            (sessions.length
              ? sessions.length + " running"
              : "starts " + target)
          : target) +
        (preset.durationMinutes
          ? "  ·  auto-stop " + preset.durationMinutes + " min"
          : "");

    const el = row(preset, { live: sessions.length > 0, subtitle, actions });

    // same picker the game list has: Start runs the saved executable, the sub-rows run any other
    if (multi) addExpander(el, preset.id, state.expandedPresets, renderPresets);

    list.appendChild(el);
    if (multi && state.expandedPresets.has(preset.id)) {
      list.appendChild(
        executableRows(preset, preset.durationMinutes || undefined),
      );
    }
  });
}

function runningFor(gameId, executable) {
  return state.running.filter(
    (s) =>
      String(s.gameId) === String(gameId) &&
      (executable === undefined || s.executable === executable),
  );
}

/**
 * The per-executable sub-rows shown under a game with more than one executable.
 * `durationMinutes` is what a preset stores; undefined falls back to the duration box.
 */
function executableRows(game, durationMinutes) {
  const wrap = document.createElement("div");
  wrap.className = "exe-list";

  (game.executables || []).forEach((exe) => {
    const session = runningFor(game.id, exe.name)[0];
    const item = document.createElement("div");
    item.className = "exe-row" + (session ? " live" : "");

    const label = document.createElement("div");
    label.className = "exe-name";
    label.textContent = exe.name;
    if (exe.isLauncher) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "launcher";
      label.appendChild(tag);
    }

    const action = session
      ? button("Stop", "danger", () => stopGame({ key: session.key }))
      : button("Start", "ghost", () =>
          startGame(game, exe.name, durationMinutes),
        );

    const queueBtn = queueAddButton(
      game,
      exe.name,
      durationMinutes,
      "Add this executable to the queue",
    );

    item.append(label, queueBtn, action);
    wrap.appendChild(item);
  });

  return wrap;
}

/** Render one game into the results list, plus its executable sub-rows when expanded. */
function appendResultRow(container, game) {
  // never let one odd entry (e.g. a custom/Steam game with no parsed executables) blank the
  // whole list - the same failure mode renderPresets used to have.
  const executables = game.executables || [];
  if (executables.length === 0) return;

  const sessions = runningFor(game.id);
  const multi = executables.length > 1;
  const saved = state.presets.some((p) => String(p.id) === String(game.id));

  const star = document.createElement("button");
  star.className = "star" + (saved ? " on" : "");
  star.title = saved ? "Remove from config.json" : "Save to config.json";
  star.textContent = saved ? "★" : "☆";
  star.addEventListener("click", () => togglePreset(game));

  const actions = [star, queueAddButton(game, executables[0].name)];

  if (game.custom) {
    const remove = button("✕", "ghost", () => removeCustomGame(game));
    remove.title = "Remove this game from custom-games.json";
    actions.push(remove);
  }

  // One process is enough for Discord to see the game, so the main button starts a single
  // executable - the per-executable list below is there when a different one is needed.
  if (sessions.length > 0) {
    actions.push(
      button(
        sessions.length > 1 ? "Stop all (" + sessions.length + ")" : "Stop",
        "danger",
        () => stopGame({ id: game.id }),
      ),
    );
  } else {
    actions.push(
      button("Start", "primary", () => startGame(game, executables[0].name)),
    );
  }

  const subtitle = multi
    ? executables.length +
      " executables" +
      (sessions.length
        ? "  ·  " + sessions.length + " running"
        : "  ·  starts " + executables[0].name)
    : executables[0].name;

  const el = row(game, { live: sessions.length > 0, subtitle, actions });

  if (multi) addExpander(el, game.id, state.expanded, renderResults);

  container.appendChild(el);
  if (multi && state.expanded.has(game.id))
    container.appendChild(executableRows(game));
}

/** Full rebuild. Keeps the scroll position so a Start/Stop does not throw the list around. */
function renderResults() {
  const container = $("results");
  const scroll = container.scrollTop;
  container.textContent = "";
  state.results.forEach((game) => appendResultRow(container, game));
  container.scrollTop = scroll;
}

function renderMeta(meta) {
  $("listMeta").textContent = meta.refreshing
    ? "refreshing…"
    : meta.count +
      " games · " +
      meta.playableHere +
      " for " +
      state.os +
      " · updated " +
      timeAgo(meta.fetchedAt);
}

/* ---------------- data flow ---------------- */

let searchTimer = null;

const PAGE_SIZE = 100;
// `generation` invalidates pages still in flight when the query changes underneath them
const paging = {
  query: "",
  total: 0,
  loading: false,
  generation: 0,
  exhausted: false,
};

function fetchPage(query, offset) {
  return api(
    "/api/games?limit=" +
      PAGE_SIZE +
      "&offset=" +
      offset +
      "&q=" +
      encodeURIComponent(query),
  );
}

function updateHint() {
  const shown = state.results.length;
  if (paging.total === 0) {
    $("resultHint").textContent = paging.query ? "No match" : "";
  } else if (shown < paging.total) {
    $("resultHint").textContent =
      "Showing " +
      shown +
      " of " +
      paging.total +
      (paging.loading ? " — loading more…" : " — scroll for more");
  } else {
    $("resultHint").textContent =
      paging.total + " match" + (paging.total === 1 ? "" : "es");
  }
}

/** Fresh search: replaces the list and scrolls back to the top. */
async function runSearch() {
  const query = $("search").value.trim();
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
    $("results").scrollTop = 0;
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (generation === paging.generation) paging.loading = false;
  }

  updateHint();
  fillViewport();
}

/** Append the next page. Called by the scroll handler and after each page lands. */
async function loadMore() {
  if (
    paging.loading ||
    paging.exhausted ||
    state.results.length >= paging.total
  )
    return;
  paging.loading = true;
  updateHint();
  const generation = paging.generation;

  try {
    const data = await fetchPage(paging.query, state.results.length);
    if (generation !== paging.generation) return;

    if (data.items.length === 0) {
      paging.exhausted = true;
    } else {
      const container = $("results");
      state.results = state.results.concat(data.items);
      data.items.forEach((game) => appendResultRow(container, game));
      paging.total = data.total;
    }
  } catch (err) {
    paging.exhausted = true; // stop hammering a failing endpoint
    toast(err.message, "error");
  } finally {
    if (generation === paging.generation) paging.loading = false;
  }

  updateHint();
  fillViewport();
}

/** With few or short rows the list may not scroll at all - keep filling until it does. */
function fillViewport() {
  const container = $("results");
  // clientHeight is 0 while the panel is hidden - filling then would fetch every page
  if (
    container.clientHeight > 0 &&
    container.scrollHeight <= container.clientHeight + 40
  )
    loadMore();
}

async function loadState() {
  const data = await api("/api/state");
  state.os = data.os;
  state.presets = data.presets;
  state.running = data.running;
  if (data.queue) state.queue = data.queue;
  $("platform").textContent = data.os;
  $("duration").value = data.settings.defaultDurationMinutes || 0;
  $("queueDelayMin").value = state.queue.delay.min;
  $("queueDelayMax").value = state.queue.delay.max;
  renderMeta(data.games);
  renderRunning();
  renderQueue();
  renderPresets();
  return data;
}

/* ---------------- wiring ---------------- */

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 180);
});

$("results").addEventListener("scroll", () => {
  const el = $("results");
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) loadMore();
});

$("steamAdd").addEventListener("click", () =>
  addCustomGame($("steamInput").value.trim()),
);
$("steamInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") addCustomGame($("steamInput").value.trim());
});

$("refreshBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  $("listMeta").textContent = "refreshing…";
  try {
    const data = await api("/api/refresh", { method: "POST" });
    renderMeta(data.games);
    await runSearch();
    toast(
      data.ok ? "Game list updated (" + data.count + " games)" : data.reason,
      data.ok ? "ok" : "error",
    );
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

$("queueStartBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  const data = await queueCall(
    state.queue.running ? "/api/queue/stop" : "/api/queue/start",
    { method: "POST" },
  );
  btn.disabled = false;
  if (data && data.ok && state.queue.running) toast("Queue started", "ok");
});

$("queueSkipBtn").addEventListener("click", () =>
  queueCall("/api/queue/skip", { method: "POST" }),
);

$("queueClearBtn").addEventListener("click", async () => {
  if (
    state.queue.items.length &&
    !confirm("Remove every entry from the queue?")
  )
    return;
  await queueCall("/api/queue", {
    method: "DELETE",
    body: JSON.stringify({ all: true }),
  });
});

// the gap is saved to config.json, so commit it on change rather than on every keystroke
$("queueDelayMin").addEventListener("change", queueSaveDelay);
$("queueDelayMax").addEventListener("change", queueSaveDelay);

$("stopAllBtn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    const data = await api("/api/stop-all", { method: "POST" });
    state.running = data.running;
    if (data.queue) state.queue = data.queue;
    refreshAll();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// live clock for the running rows, and the countdown to the queue's next game
setInterval(() => {
  document.querySelectorAll(".timer").forEach((el) => {
    const started = Number(el.dataset.startedAt);
    if (started)
      el.textContent = formatElapsed(Math.floor((Date.now() - started) / 1000));
  });
  if (state.queue.running) renderQueueStatus();
}, 1000);

// keep the panel in sync with the server (background refresh, auto-stop timers, CLI usage)
setInterval(async () => {
  try {
    const data = await api("/api/state");
    const signature = (payload) =>
      JSON.stringify([
        (payload.running || []).map((s) => s.pid),
        // the queue moves on without any pid changing (a gap between two games), so its own
        // shape has to be part of what counts as "something happened"
        payload.queue
          ? [
              payload.queue.running,
              payload.queue.currentUid,
              payload.queue.nextUid,
              payload.queue.items.map((i) => i.uid + ":" + i.status),
            ]
          : null,
      ]);
    const changed = signature(data) !== signature(state);
    state.running = data.running;
    state.presets = data.presets;
    if (data.queue) state.queue = data.queue;
    renderMeta(data.games);
    if (changed) refreshAll();
  } catch (err) {
    /* server restarting */
  }
}, 5000);

/* ---------------- risk disclaimer ---------------- */

const DISCLAIMER_KEY = "discord-quest-faker:disclaimer-dismissed";

function initDisclaimer() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(DISCLAIMER_KEY) === "1";
  } catch (err) {
    /* private mode etc. */
  }
  $("disclaimer").hidden = dismissed;
  $("disclaimerDismiss").addEventListener("click", () => {
    $("disclaimer").hidden = true;
    try {
      localStorage.setItem(DISCLAIMER_KEY, "1");
    } catch (err) {
      /* best effort */
    }
  });
}
initDisclaimer();

(async function init() {
  try {
    await loadState();
    await runSearch();
  } catch (err) {
    toast("Cannot reach the local server: " + err.message, "error");
  }
})();
