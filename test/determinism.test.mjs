// Seeded runs must reproduce exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestTube } from '../src/scenarios/testtube.js';

const run = (seed, steps = 3000, extra = {}) => {
  const sc = createTestTube({ seed, enzymes: 30, crowding: 0.3, ...extra });
  for (let i = 0; i < steps; i++) sc.step();
  return sc.world.fingerprint();
};

test('same seed, same state', () => {
  assert.equal(run(11), run(11));
  assert.equal(run(5, 2000, { perfect: true, substrateD: 1 }), run(5, 2000, { perfect: true, substrateD: 1 }));
});

test('different seed, different state', () => {
  assert.notEqual(run(11), run(12));
});

test('a sweep is reproducible too', () => {
  const go = () => {
    const sc = createTestTube({ seed: 4, enzymes: 20, crowding: 0.2 });
    sc.startSweep({ multiples: [1], targetEvents: 200, warmSteps: 200, minSteps: 500 });
    while (sc.sweep) sc.step();
    return [sc.world.fingerprint(), sc.sweeps[0].results[0].v];
  };
  assert.deepEqual(go(), go());
});
