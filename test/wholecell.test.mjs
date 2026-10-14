// Milestone 4: the whole cell grows, copies its DNA and divides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWholeCell } from '../src/scenarios/wholecell.js';

test('whole cell: seeded runs reproduce exactly', () => {
  const run = (seed) => { const sc = createWholeCell({ seed }); for (let i = 0; i < 20000; i++) sc.step(); return sc.world.fingerprint(); };
  assert.equal(run(5), run(5));
  assert.notEqual(run(5), run(6));
});

test('whole cell: grows, copies its chromosome and divides', () => {
  const sc = createWholeCell({ seed: 1 });
  const w = sc.world;
  let div = null, before = null, atLicence = null;
  sc.onDivide = (d) => { div = d; };
  const t0 = performance.now();
  for (let s = 0; s < 2600000 && !div; s++) {
    sc.step();
    if (sc.ring.licensed && !atLicence) atLicence = { area: sc.cell.area / sc.A0, copied: sc.copied(), initAt: sc.rep.initAt, doneAt: sc.rep.doneAt };
    if ((s & 1023) === 0) before = w.count;
  }
  const secs = (performance.now() - t0) / 1000;
  assert.ok(div, 'the cell divided');
  console.log(`  divided after ${(div.cycleTime / 60).toFixed(1)} min of cell time (${secs.toFixed(0)} s here); replication ${((atLicence.doneAt - atLicence.initAt) / 60).toFixed(1)} min; ribosomes ${div.partition.ribosome.join(' | ')}`);
  assert.ok(div.cycleTime > 80 * 60 && div.cycleTime < 140 * 60, `cycle ${div.cycleTime}`);
  // Division waited for both conditions.
  assert.equal(atLicence.copied, 1);
  assert.ok(atLicence.area >= 2);
  // Two forks at 75 bp/s copy 543 kbp in about an hour.
  const rep = (atLicence.doneAt - atLicence.initAt) / 60;
  assert.ok(rep > 55 && rep < 75, `replication ${rep} min`);
  // Each daughter got one whole chromosome.
  assert.deepEqual(div.partition.dna, [54, 54]);
  // The kept daughter is a newborn cell again.
  assert.ok(Math.abs(sc.cell.area / sc.A0 - 1) < 0.2, `daughter area ${sc.cell.area / sc.A0}`);
  assert.equal(sc.copied(), 0);
  // Contents split between the daughters, not lost.
  const total = Object.values(div.partition).reduce((a, [l, r]) => a + l + r, 0);
  assert.ok(Math.abs(total - before) / before < 0.02, `${total} vs ${before}`);
  // And the daughter carries on.
  for (let s = 0; s < 50000; s++) sc.step();
  assert.equal(sc.cell.cycle, 2);
});
