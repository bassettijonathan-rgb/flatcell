import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probFromRate, negLog, makeRng } from '../src/core/rng.js';
import { World, CYTO } from '../src/core/world.js';
import { paintRoundedRect } from '../src/scenarios/common.js';
import { MM_PER_MOLECULE } from '../src/core/units.js';

test('arithmetic exp and log match Math to ~1e-14', () => {
  for (const x of [1e-9, 1e-4, 0.01, 0.2, 1, 3.7, 12, 39]) {
    assert.ok(Math.abs(probFromRate(x) - (1 - Math.exp(-x))) < 1e-14, `probFromRate(${x})`);
  }
  for (const u of [1e-12, 1e-5, 0.01, 0.3, 0.5, 0.77, 0.999999, 1]) {
    assert.ok(Math.abs(negLog(u) + Math.log(u)) < 1e-13, `negLog(${u})`);
  }
});

test('rng stream is fixed for a seed', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 1000; i++) assert.equal(a.u32(), b.u32());
});

test('field diffusion spreads at the set coefficient', () => {
  const w = new World({ W: 120, H: 120, dt: 4e-6, seed: 1, fieldEvery: 10 });
  paintRoundedRect(w, 2, 2, 118, 118, 3, CYTO, 0);
  const k = w.fields.add({ name: 'S', D: 1, init: 0 });
  w.fields.data[k][60 * 120 + 60] = 1;
  for (let i = 0; i < 2000; i++) w.step();
  let m2 = 0;
  const f = w.fields.data[k];
  for (let s = 0; s < w.N; s++) { const x = (s % 120) - 60, y = Math.floor(s / 120) - 60; m2 += f[s] * (x * x + y * y); }
  const expected = (4 * 1e6 * w.time) / 100; // sites^2
  assert.ok(Math.abs(m2 / expected - 1) < 0.02, `MSD ${m2} vs ${expected}`);
});

test('enzyme kinetics conserve substrate + product mass', () => {
  const w = new World({ W: 40, H: 40, dt: 4e-6, seed: 3, fieldEvery: 10 });
  paintRoundedRect(w, 2, 2, 38, 38, 5, CYTO, 0);
  const S = w.fields.add({ name: 'S', D: 50, init: 0.5 });
  const P = w.fields.add({ name: 'P', D: 50, init: 0 });
  const sp = w.addSpecies({ name: 'E', D: 5, size: 1 });
  w.setEnzyme(sp, { subs: [S], prods: [P], kSite: [5e7], koff: [2000], kcat: 800 });
  const ids = [];
  for (let i = 0; i < 40; i++) ids.push(w.spawnRandom(sp));
  const total = () => {
    let m = w.fields.total(S) + w.fields.total(P);
    for (const i of ids) {
      m += w.state[i] * MM_PER_MOLECULE;
      for (let j = 0; j < 4; j++) m += w.credit[i * 4 + j];
    }
    return m;
  };
  const m0 = total();
  for (let i = 0; i < 5000; i++) w.step();
  assert.ok(w.events[sp] > 100, 'enzymes turned over');
  assert.ok(Math.abs(total() / m0 - 1) < 1e-9, `mass drift ${total() / m0 - 1}`);
});
