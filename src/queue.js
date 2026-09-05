'use strict';

const crypto = require('crypto');
const configModule = require('./config');
const { Spoofer } = require('./spoof');

// Guard rails for the gap between two quests. A negative or hour-long wait is never what
// someone meant to type, and 0 is allowed on purpose: it means "start the next one at once".
const MIN_DELAY_SECONDS = 0;
const MAX_DELAY_SECONDS = 3600;

/** Whole seconds in [min, max], both ends included. */
function randomBetween(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  // crypto rather than Math.random: the whole point of the gap is that it carries no pattern.
  return low + crypto.randomInt(high - low + 1);
}

function clampSeconds(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, Math.round(n)));
}

/**
 * Runs a list of games one after another.
 *
 * Each entry starts a single executable with its own auto-stop timer; when that session ends -
 * its timer ran out, its window was closed, it crashed - the runner waits a random number of
 * seconds and starts the next entry. The wait is random because a quest farm that starts a new
 * game exactly N seconds after the last one stops is a pattern; anything reading the timing
 * sees jitter instead.
 *
 * The queue only ever has one game running at a time: Discord maps a detected process to one
 * application, so a second one running alongside would add nothing but noise.
 */
class QuestQueue {
  constructor({ config, store, spoofer, save }) {
    this.config = config;
    this.store = store;
    this.spoofer = spoofer;
    // config.js writes to the real config.json and nowhere else, so the one place that has to
    // be swappable is this - a test builds a queue with its own save and touches no user state.
    this.save = save || configModule.save;

    this.items = (config.queue || []).map((entry) => this.normalize(entry)).filter(Boolean);
    this.seq = this.items.length;
    this.running = false;
    this.currentUid = null;
    this.currentKey = null; // the spoofer session key of the game running right now
    this.timer = null;
    this.nextUid = null;
    this.nextStartAt = 0;

    // The only way to learn that a session ended on its own (auto-stop timer, closed window).
    spoofer.onSessionEnd((info) => this.onSessionEnd(info));
  }

  /* ---------------- the list ---------------- */

  /** config.json holds id/name/executable/durationMinutes; everything else is runtime state. */
  normalize(entry) {
    if (!entry || !(entry.id || entry.name)) return null;
    this.seq = (this.seq || 0) + 1;
    return {
      uid: 'q' + this.seq,
      id: entry.id === undefined ? undefined : String(entry.id),
      name: entry.name || String(entry.id),
      executable: entry.executable || undefined,
      durationMinutes: Number(entry.durationMinutes) > 0 ? Number(entry.durationMinutes) : 0,
      status: 'pending',
      startedAt: 0,
      finishedAt: 0,
      reason: null
    };
  }

  persist() {
    this.config.queue = this.items.map((item) => ({
      id: item.id,
      name: item.name,
      executable: item.executable,
      durationMinutes: item.durationMinutes
    }));
    return this.save(this.config) !== null;
  }

  add(entry) {
    const game = this.store.resolve(entry.id || entry.name);
    if (!game) return { ok: false, reason: 'game not found: ' + (entry.id || entry.name) };

    const chosen = Spoofer.select(game, entry.executable)[0]
      || Spoofer.candidates(game)[0];
    if (!chosen) {
      return { ok: false, reason: game.name + ' has no executable this OS can run' };
    }

    const item = this.normalize({
      id: game.id,
      name: game.name,
      executable: chosen.name,
      durationMinutes: entry.durationMinutes
    });
    this.items.push(item);
    this.persist();
    return { ok: true, item };
  }

  update(uid, patch) {
    const item = this.items.find((i) => i.uid === String(uid));
    if (!item) return { ok: false, reason: 'not in the queue' };
    if (patch.durationMinutes !== undefined) {
      item.durationMinutes = Number(patch.durationMinutes) > 0 ? Number(patch.durationMinutes) : 0;
    }
    if (patch.executable !== undefined) item.executable = patch.executable || undefined;
    this.persist();
    return { ok: true };
  }

  remove(uid) {
    const index = this.items.findIndex((i) => i.uid === String(uid));
    if (index === -1) return { ok: false, reason: 'not in the queue' };
    // Removing the entry that is playing right now stops it too, otherwise the queue would be
    // left waiting on a session it can no longer show.
    if (this.items[index].uid === this.currentUid) this.stopCurrent();
    this.items.splice(index, 1);
    this.persist();
    if (this.running && !this.currentKey && !this.timer) this.scheduleNext(this.randomDelaySeconds());
    return { ok: true };
  }

  /** Move one entry up or down. The entry playing right now keeps playing either way. */
  move(uid, direction) {
    const index = this.items.findIndex((i) => i.uid === String(uid));
    if (index === -1) return { ok: false, reason: 'not in the queue' };
    const target = index + (String(direction) === 'up' ? -1 : 1);
    if (target < 0 || target >= this.items.length) return { ok: true };
    const [item] = this.items.splice(index, 1);
    this.items.splice(target, 0, item);
    this.persist();
    return { ok: true };
  }

  clear() {
    this.stop();
    this.items = [];
    this.persist();
    return { ok: true };
  }

  /* ---------------- the gap between quests ---------------- */

  delay() {
    const min = clampSeconds(this.config.queueDelayMinSeconds, 30);
    const max = clampSeconds(this.config.queueDelayMaxSeconds, 70);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }

  setDelay(minSeconds, maxSeconds) {
    const current = this.delay();
    const min = clampSeconds(minSeconds, current.min);
    const max = clampSeconds(maxSeconds, current.max);
    this.config.queueDelayMinSeconds = Math.min(min, max);
    this.config.queueDelayMaxSeconds = Math.max(min, max);
    this.save(this.config);
    return this.delay();
  }

  /** A fresh number for every gap - one drawn once and reused would be a pattern again. */
  randomDelaySeconds() {
    const { min, max } = this.delay();
    return randomBetween(min, max);
  }

  /* ---------------- running ---------------- */

  /** How long the entry should play for. 0 means "until something stops it". */
  durationOf(item) {
    return item.durationMinutes > 0 ? item.durationMinutes : Number(this.config.defaultDurationMinutes) || 0;
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextUid = null;
    this.nextStartAt = 0;
  }

  /**
   * Start the queue from the top. Every entry goes back to pending first, so pressing Start
   * again after a finished run replays the whole list rather than doing nothing.
   */
  start() {
    if (this.running) return { ok: false, reason: 'the queue is already running' };
    if (this.items.length === 0) return { ok: false, reason: 'the queue is empty' };

    this.items.forEach((item) => {
      item.status = 'pending';
      item.startedAt = 0;
      item.finishedAt = 0;
      item.reason = null;
    });
    this.running = true;
    console.log('[queue] started - ' + this.items.length + ' game(s), '
      + this.delay().min + '-' + this.delay().max + 's between each');
    this.launch(this.items[0]); // the first one has nothing to wait for
    return { ok: true };
  }

  /**
   * Stop the queue and whatever it is playing. Entries keep the status they reached.
   * @param {boolean} sync kill the placeholder without waiting on the event loop - the shutdown
   *   path needs this, because an async kill never runs once process.exit is on its way.
   */
  stop(sync) {
    const wasRunning = this.running;
    this.running = false; // before stopCurrent, so the session end does not advance the queue
    this.clearTimer();
    this.stopCurrent(sync);
    if (wasRunning) console.log('[queue] stopped');
    return { ok: wasRunning, reason: wasRunning ? undefined : 'the queue is not running' };
  }

  stopCurrent(sync) {
    const key = this.currentKey;
    const item = this.items.find((i) => i.uid === this.currentUid);
    // the session-end listener is deaf by now (running is already false), so the entry has to
    // be taken off "playing" here or the panel would keep showing it as live
    if (item && item.status === 'running') {
      item.status = 'stopped';
      item.finishedAt = Date.now();
    }
    this.currentKey = null;
    this.currentUid = null;
    if (key) this.spoofer.stop(key, sync);
  }

  /**
   * Move on now. While a game is playing that means stopping it and waiting out the usual
   * random gap; while waiting for that gap it means starting the next game straight away.
   */
  skip() {
    if (!this.running) return { ok: false, reason: 'the queue is not running' };

    if (this.currentKey) {
      const item = this.items.find((i) => i.uid === this.currentUid);
      if (item) {
        item.status = 'skipped';
        item.finishedAt = Date.now();
      }
      // stop() fires the session-end listener, which schedules the next entry for us
      const key = this.currentKey;
      this.currentKey = null;
      this.currentUid = null;
      this.spoofer.stop(key);
      this.scheduleNext(this.randomDelaySeconds());
      return { ok: true };
    }

    this.clearTimer();
    this.scheduleNext(0);
    return { ok: true };
  }

  /** Wait `seconds`, then start the first entry still pending. */
  scheduleNext(seconds) {
    this.clearTimer();
    if (!this.running) return;

    const next = this.items.find((item) => item.status === 'pending');
    if (!next) {
      this.running = false;
      console.log('[queue] finished - no entry left');
      return;
    }

    const wait = Math.max(0, Math.round(seconds));
    this.nextUid = next.uid;
    this.nextStartAt = Date.now() + wait * 1000;
    console.log('[queue] next up: "' + next.name + '" in ' + wait + 's');

    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextUid = null;
      this.nextStartAt = 0;
      this.launch(next);
    }, wait * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  launch(item) {
    if (!this.running) return;

    const game = this.store.resolve(item.id || item.name);
    if (!game) {
      this.failItem(item, 'game not found: ' + (item.id || item.name));
      return;
    }

    const duration = this.durationOf(item);
    const result = this.spoofer.start(game, { executable: item.executable, durationMinutes: duration });
    if (!result.ok) {
      this.failItem(item, result.reason);
      return;
    }

    const session = result.sessions[0];
    item.status = 'running';
    item.startedAt = Date.now();
    item.reason = null;
    this.currentUid = item.uid;
    this.currentKey = session.key;
    console.log('[queue] playing "' + item.name + '" / ' + session.executable
      + (duration > 0 ? ' for ' + duration + ' min' : ' until it is stopped'));

    // Without a timer nothing will ever end this session, so the queue would stall here. Say
    // so rather than looking hung - the entry still runs, it just needs a Stop or a Skip.
    if (duration === 0) {
      console.warn('[queue] "' + item.name + '" has no auto-stop time, so the queue will wait '
        + 'on it - set a duration on the entry to move on by itself');
    }
  }

  failItem(item, reason) {
    item.status = 'failed';
    item.reason = reason;
    item.finishedAt = Date.now();
    console.error('[queue] "' + item.name + '": ' + reason + ' - skipping');
    this.scheduleNext(this.randomDelaySeconds());
  }

  /** The spoofer telling us a session ended. Only the queue's own session moves it along. */
  onSessionEnd(info) {
    if (!this.running || !this.currentKey || info.key !== this.currentKey) return;

    const item = this.items.find((i) => i.uid === this.currentUid);
    if (item) {
      item.status = info.reason === 'crashed' || info.reason === 'failed' ? 'failed' : 'done';
      item.finishedAt = Date.now();
      item.reason = info.reason;
    }
    this.currentKey = null;
    this.currentUid = null;

    const wait = this.randomDelaySeconds();
    console.log('[queue] "' + info.name + '" ended (' + info.reason + ') - waiting ' + wait + 's');
    this.scheduleNext(wait);
  }

  /* ---------------- for the UI ---------------- */

  describe() {
    const { min, max } = this.delay();
    return {
      running: this.running,
      currentUid: this.currentUid,
      currentKey: this.currentKey,
      nextUid: this.nextUid,
      nextStartAt: this.nextStartAt || null,
      delay: { min, max },
      // 0 here means every entry falls back to the global auto-stop setting, which may be 0 too
      defaultDurationMinutes: Number(this.config.defaultDurationMinutes) || 0,
      items: this.items.map((item) => {
        const game = this.store.resolve(item.id || item.name);
        return {
          uid: item.uid,
          id: item.id,
          name: item.name || (game && game.name),
          icon: game ? game.icon : null,
          iconUrl: game ? game.iconUrl || null : null,
          executable: item.executable,
          durationMinutes: item.durationMinutes,
          effectiveDurationMinutes: this.durationOf(item),
          status: item.status,
          reason: item.reason,
          startedAt: item.startedAt || null,
          missing: !game
        };
      })
    };
  }
}

module.exports = { QuestQueue, randomBetween, clampSeconds, MAX_DELAY_SECONDS };
