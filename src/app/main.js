// Page controller: wires the simulation, the renderer and the panels.

import { createSimClient } from './sim-client.js';
import { createRenderer, fitView } from './render.js';
import { buildBackground } from './background.js';
import { VIEWS } from './views.js';
import { cssVar, fmtNum } from './charts.js';

const MILESTONES = [
  { id: 'm1', n: 1, label: 'Test tube', ready: true },
  { id: 'm2', n: 2, label: 'Glycolysis', ready: true },
  { id: 'm3', n: 3, label: 'Central dogma', ready: true },
  { id: 'm4', n: 4, label: 'Whole cell', ready: false },
];

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let canvas = $('view');

const app = {
  info: null,
  frame: null,
  renderer: null,
  bg: null,
  sites: null,
  layers: {},
  history: {},
  running: true,
  scenario: null,
  seed: 1,
  dirtyBg: true,
  view: null,
  waiting: false,
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function theme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light'
    || document.documentElement.dataset.theme === 'dark';
  return {
    bg: hexToRgb(cssVar('--sunken')),
    cyto: hexToRgb(cssVar('--cyto')),
    membrane: hexToRgb(cssVar('--membrane')),
    ring: hexToRgb(cssVar('--hot')),
    trail: hexToRgb(cssVar('--hot')),
    heatStrength: dark ? 0.7 : 0.62,
  };
}

// ---------------------------------------------------------------- simulation
const sim = createSimClient((msg) => {
  if (msg.type === 'info') onInfo(msg);
  else if (msg.type === 'frame') onFrame(msg);
  else if (msg.type === 'fingerprint') $('fp').innerHTML = `step ${msg.step.toLocaleString('en-US')}: <span class="fp">${msg.value}</span>`;
  else if (msg.type === 'error') console.error(msg.message);
});

function load(id, options) {
  app.scenario = id;
  sim.send({ type: 'load', scenario: id, options: { seed: app.seed, ...(options || {}) }, run: app.running });
}

function onInfo(msg) {
  const info = msg.info;
  const firstOfScenario = !app.info || app.info.id !== info.id;
  app.info = info;
  app.dirtyBg = true;
  app.sites = null;
  if (firstOfScenario) app.layers = {};
  for (const l of info.layers) if (!(l.id in app.layers)) app.layers[l.id] = l.on;
  renderTabs();
  renderLayers();
  renderControls();
  renderGene(info.gene);
  const view = VIEWS[info.id];
  app.history = {};
  view.reset(app.history);
  if (firstOfScenario || !$('charts').firstChild) view.setup($('charts'));
  app.renderer?.setSpecies(info.species, theme().trail, theme().ring);
  sendLayers();
  sim.send({ type: 'frame' });
  app.waiting = true;
}

function onFrame(f) {
  app.waiting = false;
  if (f.sites) { app.sites = f.sites; app.dirtyBg = true; }
  if (f.heat || app.frame?.heat) app.dirtyBg = true;
  app.frame = f;
  const view = VIEWS[app.info.id];
  view.update(f.stats, f, app.history);
}

// ---------------------------------------------------------------- drawing
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  if (app.renderer?.ctx?.configure && app.renderer.kind === 'WebGPU') { /* context resizes with canvas */ }
}

let lastPanel = 0;
function frameLoop(t) {
  requestAnimationFrame(frameLoop);
  const f = app.frame;
  if (f && app.renderer && app.sites) {
    if (canvas.width !== Math.round(canvas.clientWidth * (window.devicePixelRatio || 1))) resize();
    const th = theme();
    if (app.dirtyBg) {
      app.bg = buildBackground(app.bg, app.sites, f.W, f.H, f.heat || null, f.heatMax, th);
      app.renderer.setBackground(app.bg, f.W, f.H);
      app.dirtyBg = false;
    }
    const box = f.viewBox || [0, 0, f.W, f.H];
    app.view = fitView(canvas.clientWidth, canvas.clientHeight, [box[0] - 0.5, box[1] - 0.5, box[2] + 0.5, box[3] + 0.5]);
    app.renderer.draw({ view: app.view, parts: f.parts, nParts: f.nParts, trail: f.follow?.trail, clear: th.bg });
    if (t - lastPanel > 200) {
      lastPanel = t;
      updatePanels(f);
    }
  }
  if (!app.waiting) {
    app.waiting = true;
    sim.send({ type: 'frame' });
  }
}

function fmtDuration(sec) {
  const a = Math.abs(sec);
  if (a === 0) return '0 s';
  if (a < 1e-3) return `${fmtNum(sec * 1e6)} µs`;
  if (a < 1) return `${fmtNum(sec * 1e3)} ms`;
  if (a < 120) return `${fmtNum(sec)} s`;
  if (a < 7200) return `${fmtNum(sec / 60)} min`;
  return `${fmtNum(sec / 3600)} h`;
}

function updatePanels(f) {
  const info = app.info;
  const view = VIEWS[info.id];
  const boost = info.clock.boost || 1;
  const simPerSec = f.stepsPerSec * info.clock.dt * boost;
  const ratio = simPerSec;
  let compress;
  if (!f.running) compress = 'paused';
  else if (ratio <= 0) compress = 'measuring…';
  else if (ratio < 1) compress = `slow motion, ${fmtNum(1 / ratio)}× slower than real time`;
  else compress = `clock compressed ${fmtNum(ratio)}×`;
  $('clock').innerHTML = `1 s on screen = <b>${fmtDuration(ratio)}</b> of ${info.clock.unit} · ${compress}`
    + (boost > 1 ? ` · slow processes run ${boost}× faster than diffusion` : '')
    + ` · ${fmtNum(f.stepsPerSec)} steps/s`;
  $('hud-left').innerHTML = `t = ${fmtDuration(f.time * boost)}<span class="hud-step"> · step ${f.step.toLocaleString('en-US')}</span>`;
  const sbSites = app.view ? Math.max(1, Math.round(60 / app.view.pps)) : 5;
  $('hud-right').innerHTML = `<span class="scalebar"><i style="width:${(app.view?.pps || 10) * sbSites}px"></i>${sbSites * 10} nm</span> · ${app.renderer.kind}${sim.mode === 'page' ? ' · page thread' : ''}`;
  $('readouts').innerHTML = view.readouts(f.stats, f);
  view.draw(f.stats, f, app.history, $('charts'));
  renderFollow(f);
  $('run').textContent = f.running ? 'Pause' : 'Run';
}

// ---------------------------------------------------------------- panels
function renderTabs() {
  $('tabs').innerHTML = MILESTONES.map((m) =>
    `<button class="tab" role="tab" data-id="${m.id}" aria-selected="${m.id === app.scenario}" ${m.ready ? '' : 'disabled title="Coming in a later milestone"'}><span class="n">${m.n}</span>${m.label}</button>`).join('');
  for (const b of $('tabs').querySelectorAll('button')) {
    b.onclick = () => { if (b.dataset.id !== app.scenario) { $('charts').innerHTML = ''; load(b.dataset.id); } };
  }
}

function renderLayers() {
  const info = app.info;
  $('layers').innerHTML = info.layers.map((l) => {
    let sw = '';
    if (l.kind === 'species') {
      const sp = info.species.find((s) => (l.swatch ? s.name === l.swatch : 'sp:' + s.name === l.id));
      const c = sp ? sp.color.map((v) => Math.round(v * 255)).join(',') : '128,128,128';
      sw = `<span class="sw" style="background:rgb(${c})"></span>`;
    } else sw = '<span class="sw"></span>';
    return `<label class="chip ${l.kind}"><input type="checkbox" data-id="${l.id}" ${app.layers[l.id] ? 'checked' : ''}>${sw}${l.label}</label>`;
  }).join('');
  for (const cb of $('layers').querySelectorAll('input')) {
    cb.onchange = () => {
      const l = info.layers.find((x) => x.id === cb.dataset.id);
      if (l.kind === 'heat' && cb.checked) {
        // One heatmap at a time.
        for (const o of info.layers) if (o.kind === 'heat' && o.id !== l.id) app.layers[o.id] = false;
      }
      app.layers[l.id] = cb.checked;
      renderLayers();
      sendLayers();
    };
  }
}

function sendLayers() {
  const info = app.info;
  // A layer covers one species by id, or a group through its species list.
  const hidden = info.species.map((sp) => {
    const l = info.layers.find((x) => x.id === 'sp:' + sp.name || x.species?.includes(sp.name));
    return l && !app.layers[l.id] ? 1 : 0;
  });
  const heat = info.layers.find((l) => l.kind === 'heat' && app.layers[l.id]);
  sim.send({ type: 'layers', hidden, heat: heat ? heat.field : -1 });
  app.dirtyBg = true;
}

function ctlDisplay(c, v) {
  if (c.type === 'select') return '';
  const shown = c.scale ? v * c.scale : v;
  if (c.unit === '/M/s') return `${v.toExponential(1).replace('e+', 'e')} ${c.unit}`;
  return `${fmtNum(shown)}${c.unit === '%' ? '%' : c.unit ? ' ' + c.unit : ''}`;
}

function renderControls() {
  const info = app.info;
  const ms = MILESTONES.find((m) => m.id === info.id);
  $('scenario-eyebrow').textContent = `Milestone ${ms.n}`;
  $('scenario-title').textContent = info.title;
  $('scenario-blurb').textContent = info.blurb;
  $('controls').innerHTML = info.controls.map((c) => {
    const id = `ctl-${info.id}-${c.id}`;
    if (c.type === 'select') {
      return `<div class="ctl"><label for="${id}">${c.label}</label><select id="${id}" data-id="${c.id}">${c.options.map((o) => `<option value="${o.value}" ${o.value === c.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>${c.hint ? `<span class="hint">${c.hint}</span>` : ''}</div>`;
    }
    const log = c.type === 'log';
    const pos = log ? (Math.log(c.value / c.min) / Math.log(c.max / c.min)) * 1000 : c.value;
    const attrs = log ? 'min="0" max="1000" step="1"' : `min="${c.min}" max="${c.max}" step="${c.step}"`;
    return `<div class="ctl"><label for="${id}">${c.label}<output id="${id}-out">${ctlDisplay(c, c.value)}</output></label><input type="range" id="${id}" data-id="${c.id}" ${attrs} value="${pos}">${c.hint ? `<span class="hint">${c.hint}</span>` : ''}</div>`;
  }).join('');
  for (const el of $('controls').querySelectorAll('[data-id]')) {
    const c = info.controls.find((x) => x.id === el.dataset.id);
    const val = () => {
      if (c.type === 'select') return el.value;
      if (c.type === 'log') return +(c.min * (c.max / c.min) ** (el.value / 1000)).toPrecision(4);
      return +el.value;
    };
    el.oninput = () => { if (c.type !== 'select') $(`${el.id}-out`).textContent = ctlDisplay(c, val()); if (!c.rebuild) sim.send({ type: 'control', id: c.id, value: val() }); };
    el.onchange = () => { if (c.rebuild || c.type === 'select') sim.send({ type: 'control', id: c.id, value: val() }); };
  }
  $('actions').innerHTML = info.actions.map((a) => `<button class="btn" data-id="${a.id}">${a.label}</button>`).join('');
  for (const b of $('actions').querySelectorAll('button')) b.onclick = () => sim.send({ type: 'action', id: b.dataset.id });
}

function renderGene(gene) {
  if (!gene) { $('gene').innerHTML = '<p class="empty">Click a protein to see the gene behind it.</p>'; return; }
  $('gene').innerHTML = `<h2>${gene.name} <span class="pill">${gene.role}</span></h2><p>${gene.product}</p><dl class="kv">${gene.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function renderFollow(f) {
  const el = $('follow');
  if (!f.follow) {
    if (!el.querySelector('.empty')) el.innerHTML = '<p class="empty">Click any particle in the view to follow its path.</p>';
    return;
  }
  const sp = app.info.species[f.follow.species];
  const trailSites = f.follow.trail.length / 2;
  el.innerHTML = `<dl class="kv">
    <dt>Particle</dt><dd>${sp ? sp.label : 'gone'} #${f.follow.uid}</dd>
    <dt>State</dt><dd>${!f.follow.alive ? 'degraded or removed' : f.follow.note ? esc(f.follow.note) : f.follow.state > 0 ? '<span class="pill warn">bound</span>' : '<span class="pill">free</span>'}</dd>
    <dt>Sites visited</dt><dd>${trailSites}</dd>
  </dl><div class="actions"><button class="btn" id="unfollow">Stop following</button></div>`;
  $('unfollow').onclick = () => sim.send({ type: 'unfollow' });
  const geneCard = sp && app.info.genes?.[sp.gene];
  if (geneCard) renderGene(geneCard);
}

// ---------------------------------------------------------------- inputs
$('run').onclick = () => {
  app.running = !app.running;
  sim.send({ type: 'run', running: app.running });
  $('run').textContent = app.running ? 'Pause' : 'Run';
};
$('stepBtn').onclick = () => { app.running = false; sim.send({ type: 'run', running: false }); sim.send({ type: 'step', n: 100 }); };
$('reset').onclick = () => sim.send({ type: 'reset' });
$('reseed').onclick = () => {
  app.seed = Math.max(1, Math.floor(+$('seed').value || 1));
  sim.send({ type: 'reset', options: { seed: app.seed } });
  $('fp').textContent = '';
};
$('fpBtn').onclick = () => sim.send({ type: 'fingerprint' });
const speedRate = (v) => (v >= 100 ? 0 : Math.round(10 ** (1.5 + (v / 100) * 4.5)));
$('speed').oninput = () => sim.send({ type: 'speed', rate: speedRate(+$('speed').value) });

function onCanvasClick(e) {
  if (!app.view) return;
  const r = canvas.getBoundingClientRect();
  const [x, y] = app.view.toLattice(e.clientX - r.left, e.clientY - r.top);
  sim.send({ type: 'follow', x, y, radius: Math.max(1.5, 14 / app.view.pps) });
}
canvas.addEventListener('click', onCanvasClick);

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  app.dirtyBg = true;
  if (app.info) app.renderer?.setSpecies(app.info.species, theme().trail, theme().ring);
});
new MutationObserver(() => { app.dirtyBg = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

(async function boot() {
  resize();
  const prefer = new URLSearchParams(location.search).get('renderer') || 'auto';
  const made = await createRenderer(canvas, prefer);
  app.renderer = made.renderer;
  if (made.canvas !== canvas) { canvas = made.canvas; canvas.addEventListener('click', onCanvasClick); resize(); }
  window.addEventListener('resize', resize);
  // Open on the newest milestone, or the one named in the link (#m1 ...).
  const ready = MILESTONES.filter((m) => m.ready);
  const named = ready.find((m) => '#' + m.id === location.hash);
  load((named || ready[ready.length - 1]).id);
  requestAnimationFrame(frameLoop);
})();
