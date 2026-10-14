// Scenario-specific readouts and charts.

import { drawXY, drawBars, cssVar, fmtNum } from './charts.js';

const SERIES = ['#d97a2b', '#2f8f83', '#c23b55', '#3d6fb6', '#8a8a2a', '#a05db5'];

function readout(k, v, small = '') {
  return `<div class="readout"><div class="k">${k}</div><div class="v">${v}${small ? ` <small>${small}</small>` : ''}</div></div>`;
}

const f2 = (x) => fmtNum(x);

export const VIEWS = {
  m1: {
    setup(root) {
      root.innerHTML = `
        <canvas class="chart" id="c-mm" aria-label="Turnover rate against substrate concentration"></canvas>
        <div class="legend" id="lg-mm"></div>
        <canvas class="chart short" id="c-rate" aria-label="Turnover rate over time"></canvas>
        <div class="legend" id="lg-rate"></div>`;
    },
    reset(h) { h.rate = []; },
    update(stats, frame, h) {
      const th = stats.theory;
      const t = frame.time * 1e3;
      if (stats.rate > 0 && (!h.rate.length || h.rate[h.rate.length - 1][0] !== t)) h.rate.push([t, stats.rate, th.kcat * stats.S / (th.Km + stats.S)]);
      if (h.rate.length > 400) h.rate.splice(0, h.rate.length - 400);
    },
    readouts(stats) {
      const th = stats.theory;
      const vth = th.kcat * stats.S / (th.Km + stats.S);
      const dev = stats.rate > 0 ? ((stats.rate / vth - 1) * 100) : 0;
      const sw = stats.sweep ? `point ${Math.min(stats.sweep.k + 1, stats.sweep.n)} of ${stats.sweep.n}` : 'idle';
      return [
        readout('Substrate', f2(stats.S), 'mM'),
        readout('Turnover per enzyme', stats.rate > 0 ? f2(stats.rate) : '…', `/s · theory ${f2(vth)}${stats.rate > 0 ? ` (${dev >= 0 ? '+' : ''}${dev.toFixed(0)}%)` : ''}`),
        readout('Enzymes holding substrate', (stats.bound * 100).toFixed(0), '%'),
        readout('Enzyme diffusion', f2(stats.Deff), `µm²/s · free ${f2(stats.Dfree)}`),
        readout('Sweep', sw),
      ].join('');
    },
    draw(stats, frame, h, root) {
      const th = stats.theory;
      const accent = cssVar('--accent'), ink = cssVar('--ink'), hot = cssVar('--hot');
      const xMax = th.Km * 10;
      const xs = [], ys = [], ys2 = [];
      for (let k = 0; k <= 80; k++) {
        const S = (xMax * k) / 80;
        xs.push(S);
        ys.push((th.kcat * S) / (th.Km + S));
        ys2.push((th.kcat * S) / (th.Km2D + S));
      }
      const series = [{ kind: 'line', color: accent, xs, ys }];
      const legend = [`<span><i style="background:${accent}"></i>${th.label}</span>`];
      if (Math.abs(th.Km2D / th.Km - 1) > 0.02) {
        series.push({ kind: 'dashed', color: accent, xs, ys: ys2, alpha: 0.8 });
        legend.push(`<span style="color:${accent}"><i class="dash"></i></span><span>2D diffusion-limited prediction</span>`);
      }
      stats.sweeps.forEach((s, k) => {
        const c = SERIES[k % SERIES.length];
        series.push({ kind: 'points', color: c, xs: s.results.map((p) => p.S), ys: s.results.map((p) => p.v), err: s.results.map((p) => p.err) });
        legend.push(`<span><i class="dot" style="background:${c}"></i>${s.label}</span>`);
      });
      if (stats.sweep && stats.sweep.results.length) {
        const r = stats.sweep.results;
        series.push({ kind: 'points', color: hot, xs: r.map((p) => p.S), ys: r.map((p) => p.v), err: r.map((p) => p.err) });
        legend.push(`<span><i class="dot" style="background:${hot}"></i>sweep running: ${stats.sweep.label}</span>`);
      }
      if (stats.rate > 0) {
        series.push({ kind: 'points', color: ink, hollow: true, r: 5, xs: [stats.S], ys: [stats.rate] });
        legend.push(`<span><i class="dot" style="border:2px solid ${ink};background:none"></i>live</span>`);
      }
      drawXY(root.querySelector('#c-mm'), { xMax, yMax: th.kcat * 1.1, xLabel: 'substrate, mM', yLabel: 'turnovers per enzyme, /s', series });
      root.querySelector('#lg-mm').innerHTML = legend.join('');

      const R = h.rate;
      if (R.length > 1) {
        const x0 = R[0][0], x1 = R[R.length - 1][0];
        const yMax = Math.max(th.kcat * 0.3, ...R.map((p) => p[1] * 1.15), ...R.map((p) => p[2] * 1.15));
        drawXY(root.querySelector('#c-rate'), {
          xMin: x0, xMax: Math.max(x1, x0 + 1e-6), yMax, xLabel: 'tube time, ms', yLabel: 'turnovers /s',
          series: [
            { kind: 'steps', color: cssVar('--muted'), xs: R.map((p) => p[0]), ys: R.map((p) => p[2]), width: 1.2 },
            { kind: 'line', color: hot, xs: R.map((p) => p[0]), ys: R.map((p) => p[1]), width: 1.6, endDot: true },
          ],
        });
        root.querySelector('#lg-rate').innerHTML = `<span><i style="background:${hot}"></i>measured from catalytic events</span><span><i style="background:${cssVar('--muted')}"></i>theory at the current substrate</span>`;
      }
    },
  },
  m2: {
    setup(root) {
      root.innerHTML = `
        <div id="m2-pathway">
          <p class="chart-title">Flux through each step <small>· mM/s; faint bar = capacity if every enzyme were busy; % = enzymes mid-turnover</small></p>
          <canvas class="chart bars" id="c-flux" aria-label="Flux through each glycolytic step"></canvas>
          <p class="chart-title">Metabolite levels <small>· mM, log scale; tick = syn3A model level</small></p>
          <canvas class="chart bars" id="c-conc" aria-label="Metabolite concentrations"></canvas>
          <p class="chart-title">Energy charge over time</p>
          <canvas class="chart short" id="c-atp" aria-label="ATP and ADP over time"></canvas>
          <div class="legend" id="lg-atp"></div>
        </div>
        <div id="m2-pair" hidden>
          <p class="chart-title">Share of 1,3-BPG that reaches Pgk <small>· one bar per run</small></p>
          <canvas class="chart bars" id="c-yield" aria-label="Channelling yield per run"></canvas>
          <div class="legend" id="lg-yield"></div>
        </div>`;
    },
    reset(h) { h.atp = []; },
    update(stats, frame, h) {
      if (stats.mode !== 'pathway') return;
      const t = frame.time;
      if (!h.atp.length || t - h.atp[h.atp.length - 1][0] > 0.004) h.atp.push([t, stats.conc.atp, stats.conc.adp, stats.atpMade]);
      if (h.atp.length > 600) h.atp.splice(0, h.atp.length - 600);
    },
    readouts(stats) {
      if (stats.mode === 'pair') {
        const r = stats.run;
        return [
          readout('1,3-BPG made', r.made.toLocaleString('en-US'), 'molecules'),
          readout('Reached Pgk', (r.yield * 100).toFixed(1), `% · ${r.used.toLocaleString('en-US')}`),
          readout('Range before loss', fmtNm(stats.range), `cluster radius ${fmtNm(stats.clusterR)}`),
          readout('1,3-BPG level', stats.conc.bpg < 1e-6 ? '< 1' : f2(stats.conc.bpg * 1e6), 'nM'),
        ].join('');
      }
      // The bottleneck is the step running closest to its full capacity.
      const order = Object.keys(stats.flux);
      const use = (k) => stats.flux[k] / Math.max(stats.vmax[k], 1e-12);
      let busiest = order[0];
      for (const k of order) if (use(k) > use(busiest)) busiest = k;
      return [
        readout('Glucose taken up', f2(stats.uptake), 'mM/s'),
        readout('ATP made (net)', f2(stats.atpMade), `mM/s · used ${f2(stats.atpUsed)}`),
        readout('ATP : ADP', f2(stats.conc.atp / Math.max(stats.conc.adp, 1e-6)), `${f2(stats.conc.atp)} / ${f2(stats.conc.adp)} mM`),
        readout('Bottleneck', STEP_LABEL[busiest] || busiest, `at ${(use(busiest) * 100).toFixed(0)}% of capacity`),
        readout('Lactate out', f2(stats.lacOut), 'mM/s'),
      ].join('');
    },
    draw(stats, frame, h, root) {
      const pair = stats.mode === 'pair';
      root.querySelector('#m2-pathway').hidden = pair;
      root.querySelector('#m2-pair').hidden = !pair;
      if (pair) {
        const runs = stats.runs;
        const rows = runs.map((r) => ({
          label: r.arrangement === 'clustered' ? 'clustered' : 'spread',
          value: r.yield * 100,
          color: r.arrangement === 'clustered' ? cssVar('--accent') : cssVar('--hot'),
          note: `${(r.yield * 100).toFixed(1)}% of ${fmtNum(r.made)}`,
        }));
        if (rows.length) drawBars(root.querySelector('#c-yield'), { rows, max: Math.max(10, ...rows.map((r) => r.value * 1.2)), fmt: (v) => `${fmtNum(v)}%` });
        root.querySelector('#lg-yield').innerHTML = runs.map((r, k) => `<span>${k + 1}. ${r.label}</span>`).join('');
        return;
      }
      const steps = Object.keys(stats.flux);
      const fluxRows = steps.map((k) => ({
        label: STEP_LABEL[k] || k,
        value: stats.flux[k],
        track: stats.vmax[k],
        color: stepColorCss(k, steps),
        note: `${f2(stats.flux[k])} · ${(stats.occ[k] * 100).toFixed(0)}%`,
      }));
      drawBars(root.querySelector('#c-flux'), { rows: fluxRows, log: [0.01, 100], unit: 'mM/s' });
      const mets = Object.keys(stats.ref);
      const concRows = mets.map((n) => ({
        label: MET_LABEL[n] || n,
        value: stats.conc[n],
        ref: stats.ref[n],
        color: cssVar('--accent'),
        note: f2(stats.conc[n]),
      }));
      drawBars(root.querySelector('#c-conc'), { rows: concRows, log: [1e-3, 30], unit: 'mM' });
      const A = h.atp;
      if (A.length > 1) {
        const accent = cssVar('--accent'), hot = cssVar('--hot');
        const xs = A.map((p) => p[0] * 1e3);
        drawXY(root.querySelector('#c-atp'), {
          xMin: xs[0], xMax: Math.max(xs[xs.length - 1], xs[0] + 1e-6), yMax: Math.max(4, ...A.map((p) => p[1] * 1.1)),
          xLabel: 'cell time, ms', yLabel: 'mM',
          series: [
            { kind: 'line', color: accent, xs, ys: A.map((p) => p[1]), width: 1.8, endDot: true },
            { kind: 'line', color: hot, xs, ys: A.map((p) => p[2]), width: 1.8, endDot: true },
          ],
        });
        root.querySelector('#lg-atp').innerHTML = `<span><i style="background:${accent}"></i>ATP</span><span><i style="background:${hot}"></i>ADP</span>`;
      }
    },
  },
  m3: {
    setup(root) {
      root.innerHTML = `
        <p class="chart-title" id="t-prot">Watched protein <small>· copies in this cell</small></p>
        <canvas class="chart" id="c-prot" aria-label="Protein copies over time"></canvas>
        <p class="chart-title">mRNAs <small>· each one is a burst of protein above</small></p>
        <canvas class="chart short" id="c-mrna" aria-label="mRNA copies over time"></canvas>
        <div class="legend" id="lg-mrna"></div>
        <p class="chart-title">Proteins made per mRNA <small>· every gene, share of mRNAs</small></p>
        <canvas class="chart short" id="c-burst" aria-label="Histogram of proteins made per mRNA"></canvas>
        <div class="legend" id="lg-burst"></div>`;
    },
    reset(h) { h.rows = []; h.epoch = -1; },
    update(stats, frame, h) {
      if (stats.epoch !== h.epoch) { h.rows = []; h.epoch = stats.epoch; }
      for (const r of stats.newRows) h.rows.push(r);
      if (h.rows.length > 3000) h.rows.splice(0, h.rows.length - 3000);
    },
    readouts(stats) {
      const w = stats.watch, b = stats.busy;
      const half = stats.lifeMean * Math.LN2 / 60;
      return [
        readout(w.name, `${w.prot}`, `proteins · ${w.mrna} mRNA${w.mrna === 1 ? '' : 's'} now`),
        readout('mRNAs in the cell', `${stats.mrnaNow}`, `syn3A average ${f2(stats.mrnaTarget)}`),
        readout('mRNA half-life', stats.lifeN ? f2(half) : '…', `min · syn3A 2 min · ${stats.lifeN} decayed`),
        readout('Proteins per mRNA', stats.burstN ? f2(stats.burstMean) : '…', `expected ${f2(stats.bMean)}`),
        readout('Ribosomes translating', `${b.ribosome[0]} of ${b.ribosome[1]}`),
        readout('Polymerases transcribing', `${b.rnap[0]} of ${b.rnap[1]}`),
      ].join('');
    },
    draw(stats, frame, h, root) {
      const R = h.rows;
      const accent = cssVar('--accent'), hot = cssVar('--hot'), muted = cssVar('--muted');
      root.querySelector('#t-prot').innerHTML = `${stats.watch.name} protein <small>· copies in this cell; steps up in bursts, drifts down as growth dilutes it</small>`;
      if (R.length > 1) {
        const xs = R.map((r) => r[0] / 60);
        const x0 = xs[0], x1 = Math.max(xs[xs.length - 1], x0 + 5);
        drawXY(root.querySelector('#c-prot'), {
          xMin: x0, xMax: x1, yMax: Math.max(10, ...R.map((r) => r[3] * 1.15)), xLabel: 'cell time, min', yLabel: 'proteins',
          series: [{ kind: 'steps', color: hot, xs, ys: R.map((r) => r[3]), width: 1.8 }],
        });
        drawXY(root.querySelector('#c-mrna'), {
          xMin: x0, xMax: x1, yMax: Math.max(4, ...R.map((r) => r[1] + 1)), xLabel: 'cell time, min', yLabel: 'mRNAs',
          series: [
            { kind: 'steps', color: muted, xs, ys: R.map((r) => r[1]), width: 1.2 },
            { kind: 'steps', color: hot, xs, ys: R.map((r) => r[2]), width: 2 },
          ],
        });
        root.querySelector('#lg-mrna').innerHTML = `<span><i style="background:${hot}"></i>${stats.watch.name} mRNA</span><span><i style="background:${muted}"></i>all mRNAs</span>`;
      }
      const n = stats.hist.reduce((a, v) => a + v, 0);
      if (n > 0) {
        const bw = stats.bin;
        const xs = stats.hist.map((v, k) => k * bw);
        const ys = stats.hist.map((v) => v / n);
        drawXY(root.querySelector('#c-burst'), {
          xMin: 0, xMax: xs.length * bw, yMax: Math.max(...ys, ...stats.expected) * 1.15, xLabel: `proteins from one mRNA (last bar: ${(xs.length - 1) * bw}+)`, yLabel: 'share',
          series: [
            { kind: 'hist', color: accent, xs, ys, bw },
            { kind: 'points', color: hot, xs: xs.map((x) => x + bw / 2), ys: stats.expected },
          ],
        });
        root.querySelector('#lg-burst').innerHTML = `<span><i style="background:${accent}"></i>measured, ${n.toLocaleString('en-US')} mRNAs</span><span><i class="dot" style="background:${hot}"></i>translate-until-destroyed race (geometric), mean ${f2(stats.bMean)}</span>`;
      }
    },
  },
  m4: {
    setup(root) {
      root.innerHTML = `
        <p class="chart-title">Cell cycle <small>· area and DNA, relative to a newborn cell; both must reach 2 before the cell divides</small></p>
        <canvas class="chart" id="c-cycle" aria-label="Cell area and DNA content over time"></canvas>
        <div class="legend" id="lg-cycle"></div>
        <p class="chart-title">Proteins in the cell <small>· halves at each division</small></p>
        <canvas class="chart short" id="c-prot4" aria-label="Protein count over time"></canvas>
        <p class="chart-title">Divisions <small>· what each daughter got; the view follows the left one</small></p>
        <div class="divlog" id="divlog"><p class="empty">No division yet.</p></div>`;
    },
    reset(h) { h.rows = []; },
    update(stats, frame, h) {
      for (const r of stats.newRows) h.rows.push(r);
      if (h.rows.length > 4000) h.rows.splice(0, h.rows.length - 4000);
    },
    readouts(stats) {
      const min = (s) => `${f2(s / 60)}`;
      return [
        readout(`Cycle ${stats.cycle}`, stats.phase),
        readout('Age', min(stats.age), 'min since birth · syn3A doubles in 105'),
        readout('Area', f2(stats.area), '× newborn'),
        readout('DNA copied', (stats.copied * 100).toFixed(0), `%${stats.initAt >= 0 ? ` · started at ${min(stats.initAt)} min` : ''}`),
        readout('Z ring', `${stats.ring}`, `FtsZ · neck ${(stats.neck * 100).toFixed(0)}% open`),
        readout('Ribosomes · RNAP', `${stats.ribosomes} · ${stats.rnap}`, `${stats.mrna} mRNAs`),
      ].join('');
    },
    draw(stats, frame, h, root) {
      const R = h.rows;
      const accent = cssVar('--accent'), hot = cssVar('--hot'), muted = cssVar('--muted');
      if (R.length > 1) {
        const xs = R.map((r) => r[0] / 60);
        const x0 = xs[0], x1 = Math.max(xs[xs.length - 1], x0 + 10);
        drawXY(root.querySelector('#c-cycle'), {
          xMin: x0, xMax: x1, yMax: 2.5, xLabel: 'cell time, min', yLabel: '× newborn',
          series: [
            { kind: 'dashed', color: muted, xs: [x0, x1], ys: [2, 2], width: 1 },
            { kind: 'line', color: accent, xs, ys: R.map((r) => r[1]), width: 2, endDot: true },
            { kind: 'line', color: hot, xs, ys: R.map((r) => 1 + r[2]), width: 2, endDot: true },
          ],
        });
        root.querySelector('#lg-cycle').innerHTML = `<span><i style="background:${accent}"></i>area (lipid made)</span><span><i style="background:${hot}"></i>chromosome copies</span>`;
        drawXY(root.querySelector('#c-prot4'), {
          xMin: x0, xMax: x1, yMax: Math.max(...R.map((r) => r[3])) * 1.15, xLabel: 'cell time, min', yLabel: 'proteins',
          series: [{ kind: 'line', color: accent, xs, ys: R.map((r) => r[3]), width: 1.8, endDot: true }],
        });
      }
      const D = stats.divisions;
      const el = root.querySelector('#divlog');
      if (D.length && el.dataset.n !== String(D.length)) {
        el.dataset.n = String(D.length);
        const pair = (p) => `${p[0]} | ${p[1]}`;
        el.innerHTML = `<table><thead><tr><th>Cycle</th><th>Took</th><th>Ribosomes</th><th>RNAP</th><th>mRNAs</th></tr></thead><tbody>${
          D.map((d) => `<tr><td>${d.cycle}</td><td>${f2(d.cycleTime / 60)} min</td><td>${pair(d.ribosome)}</td><td>${pair(d.rnap)}</td><td>${pair(d.mrna)}</td></tr>`).join('')
        }</tbody></table>`;
      }
    },
  },
};

const STEP_LABEL = { GLCpts: 'PTS', PGI: 'Pgi', PFK: 'PfkA', FBA: 'FbaA', TPI: 'TpiA', GAPD: 'GapDH', PGK: 'Pgk', PGM: 'Pgm', ENO: 'Eno', PYK: 'Pyk', LDH: 'Ldh' };
const MET_LABEL = { g6p: 'G6P', f6p: 'F6P', fdp: 'FBP', dhap: 'DHAP', g3p: 'G3P', bpg: '1,3-BPG', pg3: '3PG', pg2: '2PG', pep: 'PEP', pyr: 'pyruvate', lac: 'lactate', atp: 'ATP', adp: 'ADP', nad: 'NAD⁺', nadh: 'NADH' };

function stepColorCss(k, steps) {
  const t = steps.indexOf(k) / Math.max(1, steps.length - 1);
  const a = [0.42, 0.27, 0.72], b = [0.13, 0.62, 0.58], c = [0.93, 0.6, 0.15];
  const mix = (p, q, u) => p.map((v, i) => v + (q[i] - v) * u);
  const rgb = t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2);
  return `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;
}

function fmtNm(x) { return x >= 1000 ? `${(x / 1000).toFixed(1)} µm` : `${Math.round(x)} nm`; }
