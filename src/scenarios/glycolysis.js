// Milestone 2: glycolysis in a patch of syn3A cytoplasm.
//
// Every glycolytic enzyme of syn3A is a particle at its measured copy number
// (scaled to this slab), the rest of the proteome is lumped into inert
// crowders, and the 15 metabolites of the pathway are concentration fields.
// The glucose transporter sits in the membrane rim and takes glucose from
// the medium. ATP is spent by the rest of the cell at a set rate, lactate
// leaves through the membrane, and everything else follows from encounters.
//
// A second mode isolates one step pair, GapDH -> 1,3-BPG -> Pgk, to show
// substrate channelling: the same enzymes clustered or spread out.

import { World, CYTO, MEMBRANE } from '../core/world.js';
import {
  D_METABOLITE, MM_PER_MOLECULE, SITE_LITERS, calibrateBinding, catchmentRadius,
  diffusionFromMass, fix,
} from '../core/units.js';
import { probFromRate } from '../core/rng.js';
import { REACTIONS, GENES, METABOLITES, CELL, MASS_PER_AA_KDA } from '../data/syn3a.js';
import { paintRoundedRect, addMembraneRim, countSites, SYN3A_LITERS } from './common.js';

// Pathway order (colours run along it) and each step's native oligomer, for
// particle mass and so diffusion.
export const STEPS = ['GLCpts', 'PGI', 'PFK', 'FBA', 'TPI', 'GAPD', 'PGK', 'PGM', 'ENO', 'PYK', 'LDH'];
const OLIGOMER = { GLCpts: 1, PGI: 2, PFK: 4, FBA: 2, TPI: 2, GAPD: 4, PGK: 1, PGM: 1, ENO: 8, PYK: 4, LDH: 4 };
export const FIELDS = ['g6p', 'f6p', 'fdp', 'dhap', 'g3p', 'bpg', 'pg3', 'pg2', 'pep', 'pyr', 'lac', 'atp', 'adp', 'nad', 'nadh'];
const D_MEMBRANE = 0.5; // um^2/s, typical for a transporter in a bacterial membrane
const KON_DEFAULT = 1e7;
const GLC_KM = 0.1;     // mM, PTS affinity for medium glucose (Thornburg et al. 2022)

export const GLYCO_DEFAULTS = {
  seed: 1,
  mode: 'pathway',      // 'pathway' | 'pair'
  glucose: 0.1,         // mM in the medium
  atpDemand: 0.25,      // /s, first-order ATP use by the rest of the cell
  crowders: true,
  // channelling pair
  arrangement: 'spread', // 'spread' | 'clustered'
  leak: 2e4,            // /s, loss of 1,3-BPG to other fates
  bpgD: D_METABOLITE,   // um^2/s, how fast the intermediate diffuses
  g3p: METABOLITES.g3p.mM, // mM G3P feeding GapDH in the pair
};

const geneOf = (rxn) => GENES.find((g) => g.rxn === rxn);

// Colour along the pathway: violet (uptake) -> teal -> amber (lactate).
function stepColor(k, n) {
  const t = k / (n - 1);
  const a = [0.42, 0.27, 0.72], b = [0.13, 0.62, 0.58], c = [0.93, 0.6, 0.15];
  const mix = (p, q, u) => p.map((v, i) => v + (q[i] - v) * u);
  return t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2);
}

function calibrate(rxn, kD, b) {
  const r = REACTIONS[rxn];
  const kSite = [], koff = [];
  for (let j = 0; j < r.subs.length; j++) {
    const kon = Math.max(KON_DEFAULT, (2 * r.kcat) / (r.Km[j] * 1e-3));
    const cal = calibrateBinding({ kcat: r.kcat, KmMilli: r.Km[j], kon, D: kD, bSites: b });
    kSite.push(cal.kSite);
    koff.push(cal.koff);
  }
  return { kSite, koff };
}

export function createGlycolysis(options = {}) {
  const opts = { ...GLYCO_DEFAULTS, ...options };
  const W = 56, H = 40;
  const dt = 4e-6;
  const world = new World({ W, H, dt, seed: opts.seed, fieldEvery: 10 });
  const pair = opts.mode === 'pair';
  paintRoundedRect(world, 4, 4, W - 4, H - 4, 7, CYTO, 0);
  const rim = pair ? 0 : addMembraneRim(world);
  const sites = countSites(world, CYTO) + rim;
  // Share of the cell this slab of cytoplasm stands for, by volume, and of
  // the membrane, by area (rim sites x 10 nm x 10 nm against 4 pi R^2).
  const volShare = (sites * SITE_LITERS) / SYN3A_LITERS;
  const areaShare = (rim * 100) / (4 * Math.PI * CELL.radiusNm ** 2);
  const molPerMM = 1 / MM_PER_MOLECULE * sites; // molecules per mM in the box

  // ------------------------------------------------------------ fields
  const F = {};
  const names = pair ? ['g3p', 'nad', 'adp', 'bpg', 'nadh', 'pg3', 'atp'] : FIELDS;
  for (const n of names) {
    const m = METABOLITES[n];
    const D = pair && n === 'bpg' ? opts.bpgD : D_METABOLITE;
    F[n] = world.fields.add({ name: n, label: m.label, D, init: pair && n === 'bpg' ? 0 : m.mM, max: Math.max(2 * m.mM, 0.05) });
  }

  // ------------------------------------------------------------ particles
  // Crowders first, then enzymes, so placement does not depend on enzyme
  // choices. Crowders lump about five average proteins (160 kDa) and leave
  // room for small molecules; ribosomes fill their site.
  const species = {};
  const nProteins = Math.round(CELL.totalProteins * volShare);
  const spRibo = world.addSpecies({ name: 'ribosome', label: 'Ribosome', D: diffusionFromMass(2700), size: 4, blocksSmall: true, color: [0.3, 0.32, 0.38], radius: 0.46, gene: 'ribosome' });
  const spCrowd = world.addSpecies({ name: 'crowder', label: 'Other proteins', D: diffusionFromMass(160), size: 2, color: [0.6, 0.62, 0.66], radius: 0.3 });
  species.ribosome = spRibo;
  species.crowder = spCrowd;

  const steps = pair ? ['GAPD', 'PGK'] : STEPS;
  const enzymes = {};
  let nEnzymes = 0;
  const counts = {};
  for (const rxn of steps) {
    const g = geneOf(rxn);
    const membrane = !!g.membrane;
    counts[rxn] = Math.max(1, Math.round(g.copies * (membrane ? areaShare : volShare)));
    nEnzymes += counts[rxn];
  }
  if (opts.crowders) {
    const nRibo = Math.round(CELL.ribosomes * volShare);
    const nCrowd = Math.max(0, Math.round((nProteins - nEnzymes) / 5));
    for (let k = 0; k < nRibo; k++) world.spawnRandom(spRibo);
    for (let k = 0; k < nCrowd; k++) world.spawnRandom(spCrowd);
  }

  const b = catchmentRadius(sites, 50);
  const ids = [];
  // Cluster: a disc in the middle of the box holding every enzyme.
  const cx = W / 2, cy = H / 2;
  const clusterR = Math.sqrt((nEnzymes * 1.6) / Math.PI) + 1;
  const inCluster = (s) => {
    const dx = (s % W) + 0.5 - cx, dy = Math.floor(s / W) + 0.5 - cy;
    return dx * dx + dy * dy <= clusterR * clusterR;
  };
  steps.forEach((rxn, k) => {
    const g = geneOf(rxn);
    const r = REACTIONS[rxn];
    const membrane = !!g.membrane;
    const kDa = g.aa * MASS_PER_AA_KDA * OLIGOMER[rxn];
    const D = membrane ? D_MEMBRANE : diffusionFromMass(kDa);
    const sp = world.addSpecies({
      name: rxn, label: g.name, D, size: kDa > 150 ? 2 : 1, compartment: membrane ? MEMBRANE : CYTO,
      color: stepColor(steps.length === 2 ? k * 2 + 4 : k, steps.length === 2 ? 11 : steps.length), radius: kDa > 150 ? 0.34 : 0.28, gene: g.id,
    });
    const cal = calibrate(rxn, D_METABOLITE + D, b);
    let kcat = r.kcat;
    if (rxn === 'GLCpts') kcat = fix(r.kcat * opts.glucose / (GLC_KM + opts.glucose));
    const prods = r.prods.map((p) => F[p]);
    world.setEnzyme(sp, { subs: r.subs.map((s) => F[s]), prods, kSite: cal.kSite, koff: cal.koff, kcat });
    species[rxn] = sp;
    enzymes[rxn] = [];
    for (let j = 0; j < counts[rxn]; j++) {
      const filter = pair && opts.arrangement === 'clustered' ? inCluster : undefined;
      const i = world.spawnRandom(sp, filter);
      if (i >= 0) { enzymes[rxn].push(i); ids.push(i); }
    }
  });
  if (pair && opts.arrangement === 'clustered') {
    // Hold the cluster together, as a scaffold or condensate would.
    for (const i of ids) world.frozen[i] = 1;
  }

  // ------------------------------------------------------------ the rest of the cell
  const Dt = world.fieldEvery * dt;
  const counters = { atpUsed: 0, lacOut: 0, bpgLost: 0 };
  const rates = { atpDemand: opts.atpDemand, leak: opts.leak };
  if (pair) {
    // Substrates held at their syn3A levels; products cleared; 1,3-BPG lost
    // to other fates at the leak rate.
    world.onFieldUpdate = () => {
      for (const n of ['g3p', 'nad', 'adp']) {
        const f = world.fields.data[F[n]], target = n === 'g3p' ? opts.g3p : METABOLITES[n].mM;
        for (let s = 0; s < f.length; s++) if (world.site[s]) f[s] = target;
      }
      const pLeak = probFromRate(rates.leak * Dt);
      const fb = world.fields.data[F.bpg];
      let lost = 0;
      for (let s = 0; s < fb.length; s++) { const d = fb[s] * pLeak; fb[s] -= d; lost += d; }
      counters.bpgLost += lost / MM_PER_MOLECULE;
      for (const n of ['nadh', 'pg3', 'atp']) world.fields.data[F[n]].fill(0);
    };
  } else {
    const pOut = probFromRate(LAC_EXPORT * Dt);
    world.onFieldUpdate = () => {
      const pUse = probFromRate(rates.atpDemand * Dt);
      const atp = world.fields.data[F.atp], adp = world.fields.data[F.adp], lac = world.fields.data[F.lac];
      let used = 0, out = 0;
      for (let s = 0; s < atp.length; s++) {
        const d = atp[s] * pUse;
        atp[s] -= d; adp[s] += d; used += d;
        const l = lac[s] * pOut;
        lac[s] -= l; out += l;
      }
      counters.atpUsed += used / MM_PER_MOLECULE;
      counters.lacOut += out / MM_PER_MOLECULE;
    };
  }

  const sc = {
    id: 'm2',
    world,
    opts,
    pair,
    F,
    species,
    enzymes,
    counts,
    steps,
    counters,
    sites,
    rim,
    volShare,
    molPerMM,
    clusterR,
    rates,
  };

  // Medium glucose sets how often a PTS encounter with PEP succeeds.
  sc.setGlucose = (mM) => {
    if (pair) return;
    opts.glucose = mM;
    const ez = world.species[species.GLCpts].enzyme;
    ez.kcatDt = fix(REACTIONS.GLCpts.kcat * mM / (GLC_KM + mM) * dt);
    ez.decayVersion = -1;
  };

  // Rolling flux window: event counters sampled every 250 steps, rates over
  // the last 100 ms of cell time.
  const SAMPLE = 500, KEEP = 50;
  const hist = [];
  const snapshot = () => {
    const e = {};
    for (const rxn of steps) e[rxn] = world.events[species[rxn]];
    return { t: world.time, e, atpUsed: counters.atpUsed, lacOut: counters.lacOut, bpgLost: counters.bpgLost };
  };
  hist.push(snapshot());
  sc.flux = () => {
    const a = hist[0], z = hist[hist.length - 1];
    const T = z.t - a.t;
    const out = { T };
    for (const rxn of steps) out[rxn] = T > 0 ? (z.e[rxn] - a.e[rxn]) / T : 0; // events per second in the box
    out.atpUsed = T > 0 ? (z.atpUsed - a.atpUsed) / T : 0;
    out.lacOut = T > 0 ? (z.lacOut - a.lacOut) / T : 0;
    out.bpgLost = T > 0 ? (z.bpgLost - a.bpgLost) / T : 0;
    return out;
  };
  sc.totals = () => snapshot();

  sc.step = () => {
    world.step();
    if (world.stepCount % SAMPLE === 0) {
      hist.push(snapshot());
      if (hist.length > KEEP + 1) hist.shift();
    }
  };

  sc.mean = (name) => world.fields.mean(F[name]);
  return sc;
}

// Lactate leaves through the membrane (lactate permease), modelled as a
// first-order export of the whole box.
const LAC_EXPORT = 5; // /s
