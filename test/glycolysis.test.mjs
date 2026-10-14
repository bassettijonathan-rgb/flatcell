// Milestone 2: the glycolysis box and the channelling pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGlycolysis } from '../src/scenarios/glycolysis.js';
import { MM_PER_MOLECULE } from '../src/core/units.js';

// Everything a field's molecules can be: free in the field, held by an
// enzyme mid-turnover, or gathered towards the next binding.
function pool(sc, names) {
  const w = sc.world;
  const idx = names.map((n) => sc.F[n]);
  let m = 0;
  for (const k of idx) m += w.fields.total(k);
  for (let i = 0; i < w.cap; i++) {
    if (!w.alive[i]) continue;
    const ez = w.species[w.kind[i]].enzyme;
    if (!ez) continue;
    for (let j = 0; j < ez.n; j++) {
      if (!idx.includes(ez.subs[j])) continue;
      if (j < w.state[i]) m += MM_PER_MOLECULE;
      m += w.credit[i * 4 + j];
    }
  }
  return m;
}

test('adenylate and NAD pools are conserved through the pathway', () => {
  const sc = createGlycolysis({ seed: 3 });
  const a0 = pool(sc, ['atp', 'adp']), n0 = pool(sc, ['nad', 'nadh']);
  for (let i = 0; i < 20000; i++) sc.step();
  assert.ok(sc.world.events[sc.species.PGK] > 50, 'Pgk turned over');
  assert.ok(Math.abs(pool(sc, ['atp', 'adp']) / a0 - 1) < 1e-9, 'ATP + ADP');
  assert.ok(Math.abs(pool(sc, ['nad', 'nadh']) / n0 - 1) < 1e-9, 'NAD + NADH');
});

test('the pathway makes ATP and aldolase emerges as the bottleneck', () => {
  const sc = createGlycolysis({ seed: 1 });
  for (let i = 0; i < 50000; i++) sc.step();
  const f = sc.flux();
  const use = {};
  for (const rxn of sc.steps) {
    const ez = sc.world.species[sc.species[rxn]].enzyme;
    use[rxn] = f[rxn] / (sc.enzymes[rxn].length * ez.kcatDt / sc.world.dt);
  }
  const net = f.PGK + f.PYK - f.PFK;
  assert.ok(net > 0, `net ATP ${net}/s`);
  assert.ok(sc.mean('atp') > 2, `ATP ${sc.mean('atp')} mM`);
  const top = Object.keys(use).sort((a, b) => use[b] - use[a])[0];
  assert.equal(top, 'FBA', `capacity use: ${JSON.stringify(use)}`);
});

test('clustering GapDH with Pgk channels more 1,3-BPG when it is lost nearby', () => {
  const yieldOf = (arrangement) => {
    const sc = createGlycolysis({ mode: 'pair', arrangement, leak: 3000, bpgD: 5, seed: 2 });
    for (let i = 0; i < 5000; i++) sc.step();
    const a = sc.totals();
    for (let i = 0; i < 50000; i++) sc.step();
    const z = sc.totals();
    return (z.e.PGK - a.e.PGK) / (z.e.GAPD - a.e.GAPD);
  };
  const spread = yieldOf('spread'), clustered = yieldOf('clustered');
  assert.ok(clustered > 1.2 * spread, `spread ${spread.toFixed(3)}, clustered ${clustered.toFixed(3)}`);
});

test('glycolysis runs reproduce exactly', () => {
  const run = () => { const sc = createGlycolysis({ seed: 9 }); for (let i = 0; i < 3000; i++) sc.step(); return sc.world.fingerprint(); };
  assert.equal(run(), run());
});
