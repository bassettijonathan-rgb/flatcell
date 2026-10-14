// Measures how far the milestone-3 lattice is from the syn3A targets for a
// given set of contact factors, after a warm-up:
//   node tools/m3cal.mjs SEED STEPS TX TL DEG
// Ratios of 1 mean the factors in CONTACT_CAL (src/scenarios/dogma.js) are right.
import { createDogma, CONTACT_CAL } from '../src/scenarios/dogma.js';
const [seed, N, tx, tl, deg] = process.argv.slice(2).map(Number);
Object.assign(CONTACT_CAL, { tx, tl, deg });
const sc = createDogma({ seed });
const w = sc.world, ex = sc.ex, B = sc.boost, dt = w.dt;
const K = ex.rows.length;
let intN = 0, intTl = 0, warm = 250000, deaths0, inits0 = 0, made0, tlInit = 0, rbBusy = 0, pBusy = 0, nS = 0;
let tgtTx = 0; for (const g of ex.rows) tgtTx += g.mrna * sc.share * g.kDeg;
// count initiations by summing prog over live + dead mRNAs: track via burstSum + live prog
const liveProg = () => { let s = 0; for (let i = 0; i < w.cap; i++) if (w.alive[i] && w.kind[i] === ex.sp.mrna) s += w.prog[i]; return s; };
const t0 = performance.now();
let p0;
for (let s = 1; s <= N; s++) {
  sc.step();
  if (s === warm) { deaths0 = ex.burstN; made0 = ex.mrnaMade.reduce((a, b) => a + b, 0); p0 = ex.burstSum + liveProg(); }
  if (s > warm) {
    let tN = 0, tT = 0;
    for (let k = 0; k < K; k++) { tN += ex.mrnaNow[k]; tT += ex.mrnaNow[k] * ex.rows[k].burst * ex.rows[k].kDeg; }
    intN += tN * dt * B; intTl += tT * dt * B;
    if (s % 1000 === 0) { nS++; for (let i = 0; i < w.cap; i++) if (w.alive[i]) { if (w.kind[i] === ex.sp.ribosome && w.state[i] > 0) rbBusy++; if (w.kind[i] === ex.sp.rnap && w.state[i] > 0) pBusy++; } }
  }
}
const T = (N - warm) * dt * B;
const deaths = ex.burstN - deaths0, made = ex.mrnaMade.reduce((a, b) => a + b, 0) - made0, inits = ex.burstSum + liveProg() - p0;
let cnt = {}; for (let i = 0; i < w.cap; i++) if (w.alive[i]) { const n = w.species[w.kind[i]].name; if (['rnap','ribosome','degradosome','other','mrna'].includes(n)) cnt[n] = (cnt[n] || 0) + 1; }
console.log(JSON.stringify({ seed, T: Math.round(T), kDegRatio: +(deaths / intN / ex.rows[0].kDeg).toFixed(3), tlRatio: +(inits / intTl).toFixed(3), txRatio: +(made / T / tgtTx).toFixed(3), meanMRNA: +(intN / T).toFixed(2), tgtMRNA: +(tgtTx / ex.rows[0].kDeg).toFixed(2), riboBusy: +(rbBusy / nS).toFixed(1), riboBusyTgt: +ex.riboBusy.toFixed(1), rnapBusy: +(pBusy / nS).toFixed(2), rnapBusyTgt: +ex.rnapBusy.toFixed(2), deaths, cnt, usStep: +((performance.now() - t0) * 1000 / N).toFixed(1) }));
