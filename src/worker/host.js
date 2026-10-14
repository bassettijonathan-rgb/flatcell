// Runs a scenario and answers the page. The same code runs inside a Web
// Worker (normal case) or on the main thread when workers are unavailable.
//
// Messages in:  load, run, speed, control, action, frame, follow, unfollow
// Messages out: info, frame, error

import { SCENARIOS } from '../scenarios/index.js';
import { packParticles, nearestParticle, indexOfUid } from '../scenarios/common.js';

const TRAIL_MAX = 600;

export function createHost(post, { budgetMs = 12, now = () => performance.now(), schedule } = {}) {
  let def = null, adapter = null, opts = null, carry = {};
  let running = false;
  let targetRate = Infinity;     // steps per second
  let credit = 0, lastTick = 0;
  let measured = 0, measuredAt = 0, stepsAtMeasure = 0;
  let wantFrame = false;
  let layers = { hidden: [], heat: -1 };
  let follow = { uid: -1, trail: [], lastPos: -1 };
  let partBuf = null;
  let sentSiteVersion = -1;
  // Run again at once while simulating (a MessageChannel avoids the 4 ms
  // clamp on nested timers), otherwise poll gently.
  let channel = null;
  let pending = null;
  const sched = schedule || ((fn) => {
    if (running && typeof MessageChannel !== 'undefined') {
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => { const f = pending; pending = null; f(); };
      }
      pending = fn;
      channel.port2.postMessage(0);
    } else {
      setTimeout(fn, 16);
    }
  });

  function load(id, options, keepCarry) {
    def = SCENARIOS[id];
    if (!keepCarry) carry = {};
    opts = { ...def.defaults, ...(options || {}) };
    adapter = def.create(opts, carry);
    opts = adapter.opts;
    sentSiteVersion = -1;
    follow = { uid: -1, trail: [], lastPos: -1 };
    measured = 0;
    stepsAtMeasure = adapter.world.stepCount;
    measuredAt = now();
    post({ type: 'info', info: adapter.info(), seed: adapter.world.seed });
  }

  function trackFollow() {
    if (follow.uid < 0) return;
    const w = adapter.world;
    let i = follow.index;
    if (i === undefined || i < 0 || !w.alive[i] || w.uid[i] !== follow.uid) {
      i = indexOfUid(w, follow.uid);
      follow.index = i;
      if (i < 0) return;
    }
    const s = w.pos[i];
    if (s !== follow.lastPos) {
      follow.trail.push((s % w.W) + 0.5, Math.floor(s / w.W) + 0.5);
      if (follow.trail.length > TRAIL_MAX * 2) follow.trail.splice(0, follow.trail.length - TRAIL_MAX * 2);
      follow.lastPos = s;
    }
  }

  function tick() {
    if (!adapter) { sched(tick); return; }
    const t0 = now();
    if (running) {
      const elapsed = Math.min(0.25, (t0 - lastTick) / 1000);
      let todo = targetRate === Infinity ? Infinity : (credit += targetRate * elapsed);
      let done = 0;
      while (done < todo) {
        adapter.step();
        if (follow.uid >= 0) trackFollow();
        done++;
        if ((done & 31) === 0 && now() - t0 > budgetMs) break;
      }
      if (targetRate !== Infinity) credit = Math.max(0, credit - done);
    }
    lastTick = t0;
    const t = now();
    if (t - measuredAt > 500) {
      const steps = adapter.world.stepCount - stepsAtMeasure;
      measured = (steps * 1000) / (t - measuredAt);
      measuredAt = t;
      stepsAtMeasure = adapter.world.stepCount;
    }
    if (wantFrame) sendFrame();
    sched(tick);
  }

  function sendFrame() {
    wantFrame = false;
    const w = adapter.world;
    const hidden = layers.hidden;
    const followIndex = follow.uid >= 0 ? (follow.index ?? -1) : -1;
    const packed = packParticles(w, null, { hidden, followIndex, busy: adapter.busy });
    partBuf = packed.buf;
    const msg = {
      type: 'frame',
      W: w.W, H: w.H,
      step: w.stepCount,
      time: w.time,
      running,
      stepsPerSec: running ? measured : 0,
      parts: packed.buf, nParts: packed.length / 4,
      stats: adapter.stats(),
      viewBox: adapter.viewBox,
      fingerprint: null,
    };
    const transfer = [packed.buf.buffer];
    if (w.siteVersion !== sentSiteVersion) {
      msg.sites = w.site.slice();
      transfer.push(msg.sites.buffer);
      sentSiteVersion = w.siteVersion;
    }
    if (layers.heat >= 0 && layers.heat < w.fields.data.length) {
      const f = w.fields.data[layers.heat];
      const heat = new Float32Array(f.length);
      for (let s = 0; s < f.length; s++) heat[s] = f[s];
      msg.heat = heat;
      msg.heatField = layers.heat;
      msg.heatMax = w.fields.defs[layers.heat].max;
      transfer.push(heat.buffer);
    }
    if (follow.uid >= 0) {
      const i = follow.index;
      msg.follow = {
        uid: follow.uid,
        alive: i >= 0 && w.alive[i] === 1,
        species: i >= 0 ? w.kind[i] : -1,
        state: i >= 0 ? w.state[i] : 0,
        age: i >= 0 ? w.time - w.born[i] : 0,
        trail: Float32Array.from(follow.trail),
      };
    }
    post(msg, transfer);
  }

  function onMessage(m) {
    try {
      switch (m.type) {
        case 'load':
          load(m.scenario, m.options);
          running = m.run ?? running;
          break;
        case 'run':
          running = m.running;
          credit = 0;
          lastTick = now();
          break;
        case 'speed':
          targetRate = m.rate > 0 ? m.rate : Infinity;
          credit = 0;
          break;
        case 'step':
          for (let k = 0; k < (m.n || 1); k++) adapter.step();
          wantFrame = true;
          break;
        case 'control': {
          const next = adapter.control(m.id, m.value);
          if (next) load(adapter.info().id, next, true);
          break;
        }
        case 'action': {
          const next = adapter.action(m.id);
          if (next) load(adapter.info().id, next, true);
          break;
        }
        case 'reset':
          load(adapter.info().id, { ...opts, ...(m.options || {}) }, true);
          break;
        case 'layers':
          layers = { hidden: Uint8Array.from(m.hidden || []), heat: m.heat ?? -1 };
          break;
        case 'frame':
          wantFrame = true;
          break;
        case 'follow': {
          const w = adapter.world;
          const i = nearestParticle(w, m.x, m.y, m.radius || 2.5);
          follow = { uid: i >= 0 ? w.uid[i] : -1, index: i, trail: [], lastPos: -1 };
          if (i >= 0) trackFollow();
          wantFrame = true;
          break;
        }
        case 'unfollow':
          follow = { uid: -1, trail: [], lastPos: -1 };
          break;
        case 'fingerprint':
          post({ type: 'fingerprint', step: adapter.world.stepCount, value: adapter.world.fingerprint() });
          break;
      }
    } catch (err) {
      post({ type: 'error', message: String(err && err.stack || err) });
    }
  }

  lastTick = now();
  sched(tick);
  return { onMessage };
}
