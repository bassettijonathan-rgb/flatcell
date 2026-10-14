// Milestone 1: one syn3A enzyme and its substrate in a test tube.
//
// Enzymes and inert crowder proteins are particles; substrate and product
// are concentration fields. The substrate is held at a fixed mean
// concentration (a chemostat) so every point of a sweep is a steady-state
// rate. Rates are counted from catalytic events, never computed from the
// Michaelis-Menten formula.

import { World, CYTO } from '../core/world.js';
import {
  D_METABOLITE, MM_PER_MOLECULE, NA, SITE_LITERS, calibrateBinding, encounterRate2D,
  catchmentRadius, diffusionFromMass, predictedKm, fix,
} from '../core/units.js';
import { REACTIONS, GENES, MASS_PER_AA_KDA } from '../data/syn3a.js';
import { paintRoundedRect, countSites, SYN3A_LITERS } from './common.js';

export const ENZYME_CHOICES = ['TPI', 'PGI', 'PGM', 'ENO'];
const GENE_OF = { TPI: 'tpiA', PGI: 'pgi', PGM: 'pgm', ENO: 'eno' };
// Native oligomeric state, for the particle mass (and so its diffusion).
const OLIGOMER = { TPI: 2, PGI: 2, PGM: 1, ENO: 8 };
const SWEEP_MULTIPLES = [0.1, 0.25, 0.5, 1, 2, 4, 8];

// Intrinsic association rate for substrate binding (M^-1 s^-1). Typical
// enzyme-metabolite association rates are 1e6-1e8; we use 1e7 unless the
// measured kcat/Km needs more.
const KON_DEFAULT = 1e7;

export const TESTTUBE_DEFAULTS = {
  seed: 1,
  enzyme: 'TPI',
  enzymes: 0,          // 0 = syn3A concentration
  crowding: 0.3,       // fraction of tube sites filled by crowders
  substrateD: D_METABOLITE,
  S: null,             // mM, null = Km
  kon: null,           // M^-1 s^-1, null = default for the enzyme
  anchored: false,     // enzymes held in place (only substrate moves)
  perfect: false,      // diffusion-limited enzyme: binds almost every encounter
};

export function defaultKon(name) {
  const r = REACTIONS[name];
  return Math.max(KON_DEFAULT, 2 * r.kcat / (r.Km[0] * 1e-3));
}

export function enzymeSetup(name, sites, nEnzymes, konOverride) {
  const r = REACTIONS[name];
  const gene = GENES.find((g) => g.id === GENE_OF[name]);
  const kDa = gene.aa * MASS_PER_AA_KDA * OLIGOMER[name];
  const D = diffusionFromMass(kDa);
  const kon = konOverride || defaultKon(name);
  // Calibrate against the physiological substrate diffusion, so the target
  // Km and kcat are reproduced for a small-molecule substrate.
  const b = catchmentRadius(sites, nEnzymes);
  const cal = calibrateBinding({ kcat: r.kcat, KmMilli: r.Km[0], kon, D: D_METABOLITE + D, bSites: b });
  return { r, gene, kDa: fix(kDa), D, kon, b, cal };
}

export function createTestTube(options = {}) {
  const opts = { ...TESTTUBE_DEFAULTS, ...options };
  const W = 56, H = 40;
  const dt = 4e-6;
  const world = new World({ W, H, dt, seed: opts.seed, fieldEvery: opts.fieldEvery ?? 10 });
  const sites = paintRoundedRect(world, 4, 4, W - 4, H - 4, 7, CYTO, 0);

  const name = opts.enzyme;
  // syn3A copy number -> concentration -> particles in this tube.
  const gene = GENES.find((g) => g.id === GENE_OF[name]);
  const nativeUM = (gene.copies / OLIGOMER[name]) / (NA * SYN3A_LITERS) * 1e6;
  const nativeCount = Math.max(1, Math.round(nativeUM * 1e-6 * NA * SITE_LITERS * sites));
  const nE = opts.enzymes > 0 ? opts.enzymes : nativeCount;
  const setup = enzymeSetup(name, sites, nE, opts.kon);
  if (opts.perfect) {
    // A "perfect" enzyme: substrate is caught on 4 of 5 encounters and never
    // let go, so turnover at low substrate is set by how fast substrate
    // diffuses in. Calibrated for an uncrowded tube; crowding then shows up
    // as a shortfall against that reference.
    const kD = encounterRate2D(opts.substrateD + (opts.anchored ? 0 : setup.D), setup.b);
    setup.cal = { kSite: fix(4 * kD), koff: 0, kD, kOnEff: fix(0.8 * kD), note: 'diffusion-limited enzyme' };
  }
  const { r, cal } = setup;
  const KmRef = opts.perfect
    ? predictedKm({ kSite: cal.kSite, koff: 0, kcat: r.kcat, D: opts.substrateD + (opts.anchored ? 0 : setup.D), bSites: setup.b })
    : r.Km[0];

  const S0 = opts.S ?? fix(KmRef);
  const fS = world.fields.add({ name: 'S', label: r.subs[0].toUpperCase() + ' (substrate)', D: opts.substrateD, clamp: S0, init: S0, max: 2 * S0 });
  const fP = world.fields.add({ name: 'P', label: r.prods[0].toUpperCase() + ' (product)', D: D_METABOLITE, init: 0, max: S0 });

  // Crowders: inert 160 kDa proteins that fill a whole site and keep small
  // molecules out of it.
  const crowderKDa = 160;
  const spCrowd = world.addSpecies({
    name: 'crowder', label: 'Crowder protein', D: diffusionFromMass(crowderKDa), size: 4,
    blocksSmall: true, color: [0.55, 0.58, 0.64], radius: 0.42,
  });
  const spE = world.addSpecies({
    name: 'enzyme', label: gene.name, D: setup.D, size: 1, color: [0.95, 0.55, 0.15], radius: 0.36, gene: gene.id,
  });
  world.setEnzyme(spE, { subs: [fS], prods: [fP], kSite: [cal.kSite], koff: [cal.koff], kcat: r.kcat });

  const nCrowd = Math.round(opts.crowding * sites);
  for (let k = 0; k < nCrowd; k++) world.spawnRandom(spCrowd);
  const enzymes = [];
  for (let k = 0; k < nE; k++) {
    const i = world.spawnRandom(spE);
    if (i >= 0) {
      enzymes.push(i);
      if (opts.anchored) world.frozen[i] = 1;
    }
  }

  // Product is washed out like a chemostat outflow, so its heatmap reaches
  // a steady state. It never feeds back on the enzyme.
  const washPerUpdate = 1 - Math.min(0.5, 200 * world.fieldEvery * dt);
  world.onFieldUpdate = () => {
    const f = world.fields.data[fP];
    for (let s = 0; s < f.length; s++) f[s] *= washPerUpdate;
  };

  // ---------------------------------------------------------- measurement
  const sc = {
    S: S0,
    id: 'm1',
    title: 'Test tube',
    world,
    opts,
    setup: { ...setup, nE, nativeCount, nativeUM, sites, crowders: nCrowd },
    fields: { S: fS, P: fP },
    species: { enzyme: spE, crowder: spCrowd },
    enzymes,
    sweep: null,
    sweeps: [],
    live: { events0: 0, t0: 0, rate: 0, err: 0, S: S0, n: 0 },
    msd: { ref: new Int32Array(enzymes.length), lastStep: 0, sum: 0, n: 0, D: 0 },
  };
  for (let k = 0; k < enzymes.length; k++) sc.msd.ref[k] = world.pos[enzymes[k]];

  sc.setS = (S) => {
    world.fields.defs[fS].clamp = S;
    sc.S = S;
    world.fields.defs[fS].max = 2 * S;
    world.fields.defs[fP].max = S;
    sc.live = { events0: world.events[spE], t0: world.time, rate: 0, err: 0, S, n: 0 };
  };

  sc.startSweep = (opts2 = {}) => {
    const Km = sc.theory().Km;
    sc.sweep = {
      points: (opts2.multiples || SWEEP_MULTIPLES).map((m) => fix(m * Km)),
      k: 0,
      phase: 'warm',
      left: opts2.warmSteps ?? 2000,
      warmSteps: opts2.warmSteps ?? 2000,
      minSteps: opts2.minSteps ?? 4000,
      maxSteps: opts2.maxSteps ?? 400000,
      targetEvents: opts2.targetEvents ?? 1500,
      results: [],
      label: opts2.label || '',
      ev0: 0, t0: 0, s0: 0,
    };
    sc.setS(sc.sweep.points[0]);
  };

  sc.stepSweep = () => {
    const sw = sc.sweep;
    if (!sw) return;
    if (sw.phase === 'warm') {
      if (--sw.left > 0) return;
      sw.phase = 'measure';
      sw.ev0 = world.events[spE];
      sw.t0 = world.time;
      sw.s0 = world.stepCount;
      return;
    }
    const ev = world.events[spE] - sw.ev0;
    const steps = world.stepCount - sw.s0;
    if ((ev >= sw.targetEvents && steps >= sw.minSteps) || steps >= sw.maxSteps) {
      const T = world.time - sw.t0;
      const v = ev / (enzymes.length * T);
      sw.results.push({ S: sw.points[sw.k], v, err: Math.sqrt(Math.max(ev, 1)) / (enzymes.length * T), events: ev, T });
      sw.k++;
      if (sw.k >= sw.points.length) {
        sc.sweeps.push({ label: sw.label || sc.describe(), results: sw.results, crowding: opts.crowding, substrateD: world.fields.defs[fS].D });
        sc.sweep = null;
        sc.setS(S0);
        return;
      }
      sw.phase = 'warm';
      sw.left = sw.warmSteps;
      sc.setS(sw.points[sw.k]);
    }
  };

  sc.stepLive = () => {
    const L = sc.live;
    const ev = world.events[spE] - L.events0;
    const T = world.time - L.t0;
    if (T > 2e-3 && ev >= 50) {
      const v = ev / (enzymes.length * T);
      // Exponential moving average across windows.
      L.n++;
      const a = L.n === 1 ? 1 : 0.3;
      L.rate = L.rate * (1 - a) + v * a;
      L.err = Math.sqrt(ev) / (enzymes.length * T);
      L.events0 = world.events[spE];
      L.t0 = world.time;
    }
    // Enzyme diffusion from mean-squared displacement over 50-step windows.
    const M = sc.msd;
    if (world.stepCount - M.lastStep >= 50) {
      let sum = 0;
      for (let k = 0; k < enzymes.length; k++) {
        const a = M.ref[k], b = world.pos[enzymes[k]];
        const dx = (b % W) - (a % W), dy = Math.floor(b / W) - Math.floor(a / W);
        sum += dx * dx + dy * dy;
        M.ref[k] = b;
      }
      const t = (world.stepCount - M.lastStep) * dt;
      const D = (sum / enzymes.length) * 100 / (4 * t) / 1e6; // um^2/s
      M.n++;
      M.D += (D - M.D) / Math.min(M.n, 200);
      M.lastStep = world.stepCount;
    }
  };

  sc.step = () => {
    world.step();
    sc.stepSweep();
    sc.stepLive();
  };

  sc.describe = () => {
    const c = Math.round(opts.crowding * 100);
    const D = world.fields.defs[fS].D;
    return `${c}% crowded, substrate D ${D >= 10 ? Math.round(D) : D.toPrecision(2)} µm²/s`;
  };

  // Michaelis-Menten references: the measured syn3A constants, and what the
  // 2D lattice should give at the current substrate diffusion (it differs
  // only when substrate diffusion is slowed).
  sc.theory = () => {
    const D = world.fields.defs[fS].D;
    const Km2D = predictedKm({ kSite: cal.kSite, koff: cal.koff, kcat: r.kcat, D: D + (opts.anchored ? 0 : setup.D), bSites: setup.b });
    return opts.perfect
      ? { kcat: r.kcat, Km: Km2D, Km2D, label: 'diffusion-limited estimate (uncrowded, enzymes evenly spread)' }
      : { kcat: r.kcat, Km: r.Km[0], Km2D, label: 'Michaelis-Menten, syn3A kcat and Km' };
  };

  sc.countFree = () => {
    let free = 0;
    for (const i of enzymes) if (world.state[i] === 0) free++;
    return free;
  };

  sc.sitesFilled = () => countSites(world, CYTO);
  return sc;
}
