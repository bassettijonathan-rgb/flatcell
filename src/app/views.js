// Scenario-specific readouts and charts.

import { drawXY, cssVar, fmtNum } from './charts.js';

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
};
