// Milestone 1 acceptance: Michaelis-Menten kinetics emerge from encounters
// on the lattice and land within 10% of the analytic curve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestTube } from '../src/scenarios/testtube.js';

function sweep(options, multiples, targetEvents = 1500) {
  const sc = createTestTube(options);
  sc.startSweep({ multiples, targetEvents });
  while (sc.sweep) sc.step();
  return { sc, results: sc.sweeps[0].results, th: sc.theory() };
}

for (const crowding of [0, 0.3]) {
  test(`TPI turnover matches Michaelis-Menten within 10% (${crowding * 100}% crowded)`, () => {
    const { results, th } = sweep({ enzyme: 'TPI', enzymes: 60, crowding, seed: 7 }, [0.25, 1, 4]);
    for (const p of results) {
      const v = (th.kcat * p.S) / (th.Km + p.S);
      const dev = p.v / v - 1;
      assert.ok(Math.abs(dev) < 0.1, `S=${p.S} mM: measured ${p.v.toFixed(1)}/s vs theory ${v.toFixed(1)}/s (${(dev * 100).toFixed(1)}%)`);
    }
  });
}

test('PGI (a different enzyme) also lands within 10%', () => {
  const { results, th } = sweep({ enzyme: 'PGI', enzymes: 40, crowding: 0, seed: 3 }, [0.5, 2]);
  for (const p of results) {
    const v = (th.kcat * p.S) / (th.Km + p.S);
    assert.ok(Math.abs(p.v / v - 1) < 0.1, `S=${p.S}: ${p.v} vs ${v}`);
  }
});

test('crowding slows a diffusion-limited enzyme', () => {
  const rate = (crowding) => {
    const sc = createTestTube({ perfect: true, substrateD: 1, enzymes: 30, crowding, seed: 2 });
    const w = sc.world;
    for (let i = 0; i < 4000; i++) w.step();
    const e0 = w.events[sc.species.enzyme], t0 = w.time;
    for (let i = 0; i < 40000; i++) w.step();
    return (w.events[sc.species.enzyme] - e0) / (w.time - t0) / sc.enzymes.length;
  };
  const free = rate(0), crowded = rate(0.4);
  assert.ok(crowded < 0.85 * free, `uncrowded ${free.toFixed(0)}/s, 40% crowded ${crowded.toFixed(0)}/s`);
});
