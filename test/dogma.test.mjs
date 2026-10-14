// Milestone 3: transcription, translation and decay on encounters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDogma } from '../src/scenarios/dogma.js';

test('central dogma: seeded runs reproduce exactly', () => {
  const run = (seed) => { const sc = createDogma({ seed }); for (let i = 0; i < 30000; i++) sc.step(); return sc.world.fingerprint(); };
  assert.equal(run(3), run(3));
  assert.notEqual(run(3), run(4));
});

test('central dogma: mRNA half-life, burst size and mRNA level match syn3A', () => {
  const sc = createDogma({ seed: 1 });
  const { world: w, ex } = sc;
  const warm = 250000, N = 1500000;
  let intN = 0, made0 = 0, dead0 = 0;
  for (let s = 1; s <= N; s++) {
    sc.step();
    if (s === warm) { made0 = ex.mrnaMade.reduce((a, b) => a + b, 0); dead0 = ex.lifetimeN; }
    if (s > warm) { let n = 0; for (const v of ex.mrnaNow) n += v; intN += n; }
  }
  const T = (N - warm) * w.dt * sc.boost;
  const meanMRNA = intN / (N - warm);
  const target = ex.rows.reduce((a, g) => a + g.mrna, 0) * sc.share;
  const deaths = ex.lifetimeN - dead0;
  const kDeg = deaths / (meanMRNA * T);
  const halfLife = Math.LN2 / kDeg / 60;
  const B = ex.bursts;
  const bMean = B.reduce((a, b) => a + b, 0) / B.length;
  const bVar = B.reduce((a, b) => a + (b - bMean) ** 2, 0) / B.length;
  const wsum = ex.rows.reduce((a, g) => a + g.mrna, 0);
  const bTarget = ex.rows.reduce((a, g) => a + g.mrna * g.burst, 0) / wsum;
  console.log(`  mRNAs ${meanMRNA.toFixed(2)} (target ${target.toFixed(2)}), half-life ${halfLife.toFixed(2)} min, proteins/mRNA ${bMean.toFixed(1)} (target ${bTarget.toFixed(1)}), Fano ${(bVar / bMean).toFixed(1)}, ${deaths} decays, made ${ex.mrnaMade.reduce((a, b) => a + b, 0) - made0}`);
  assert.ok(Math.abs(halfLife / 2 - 1) < 0.2, `half-life ${halfLife}`);
  assert.ok(Math.abs(meanMRNA / target - 1) < 0.25, `mRNA level ${meanMRNA}`);
  assert.ok(Math.abs(bMean / bTarget - 1) < 0.2, `burst ${bMean}`);
  // Proteins come in bursts: one mRNA gives a geometric number of proteins,
  // whose variance is far above the mean (Poisson output would give 1).
  assert.ok(bVar / bMean > 5, `Fano ${bVar / bMean}`);
});
