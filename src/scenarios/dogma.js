// Milestone 3: the central dogma in a 2D syn3A cell.
//
// A disc-shaped cell (radius 200 nm) with its chromosome as a chain of DNA
// beads in the middle. RNA polymerases, ribosomes and RNA degradosomes are
// particles. Every event happens on contact:
//   RNAP next to a promoter        -> may start a transcript; it stays put
//                                     while it copies the gene, then lets a
//                                     new mRNA go;
//   ribosome next to an mRNA       -> may start translating; it holds the
//                                     mRNA still until the protein is done;
//   degradosome next to an mRNA    -> may destroy it.
// Each contact has a fixed chance per step, set so that a well-mixed cell
// would reproduce syn3A's mRNA levels, 2-minute mRNA half-life and protein
// output. Whatever the lattice does on top of that (crowding, the nucleoid,
// ribosomes all busy) shows up in the measured numbers.
//
// Slow processes (elongation, initiation, decay) run `boost` times faster
// than diffusion, so a cell cycle fits in minutes; the clock shows both.
//
// The machinery here is reused by the whole-cell milestone.

import { World, CYTO, MEMBRANE, OUTSIDE } from '../core/world.js';
import { SITE_LITERS, diffusionFromMass, fix } from '../core/units.js';
import { GENES, CELL, PROCESS_RATES, MASS_PER_AA_KDA } from '../data/syn3a.js';
import { countSites, SYN3A_LITERS } from './common.js';

export const DOGMA_DEFAULTS = {
  seed: 1,
  boost: 1000,
  watch: 'gapDH',
  ribosomes: 1,      // multiple of the syn3A level
  degradosomes: 1,
};

// Per-contact chances start from a well-mixed estimate of how often two
// particles meet. On the lattice they meet less often than that (ribosomes
// are big and slow, new mRNAs start inside the nucleoid), so each chance is
// scaled by a factor measured once in a long run of this cell, the same way
// enzyme site probabilities are tuned to kcat and Km in milestone 1.
export const CONTACT_CAL = { tx: 1.34, tl: 2.4, deg: 1.75 };

const LN2 = Math.LN2;
const DNA_BEADS = 54;             // ~10 kbp each
const MRNA_D = 0.5;               // um^2/s; bacterial mRNAs measure 0.03-1
const OTHER_AA = 330;             // average syn3A protein length
const LUMP = 5;                   // proteins per "other proteins" crowder particle
const ROLE_COLOR = {
  uptake: [0.42, 0.27, 0.72],
  glycolysis: [0.13, 0.62, 0.58],
  lipids: [0.85, 0.66, 0.2],
  transcription: [0.36, 0.42, 0.9],
  translation: [0.25, 0.27, 0.33],
  replication: [0.8, 0.35, 0.55],
  division: [0.93, 0.45, 0.2],
};

// Paint a disc cell with a one-site membrane rim.
export function paintDisc(world, cx, cy, R) {
  const { W, H } = world;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const r2 = dx * dx + dy * dy;
      const s = y * W + x;
      if (r2 <= R * R) world.site[s] = r2 <= (R - 1) * (R - 1) ? CYTO : MEMBRANE;
    }
  }
  world.touchSites();
}

// Lay the chromosome down as a compact self-avoiding walk around (cx, cy):
// each bead in a site next to the previous one. Deterministic for a seed.
export function layChromosome(world, spDNA, cx, cy, nBeads, maxR) {
  const { W, rng } = world;
  const inR = (s) => {
    const dx = (s % W) + 0.5 - cx, dy = Math.floor(s / W) + 0.5 - cy;
    return dx * dx + dy * dy <= maxR * maxR && world.site[s] === CYTO;
  };
  const used = new Set();
  const path = [Math.floor(cy) * W + Math.floor(cx)];
  used.add(path[0]);
  const nb = [1, -1, W, -W];
  let guard = 0;
  while (path.length < nBeads && guard++ < 100000) {
    const s = path[path.length - 1];
    // Prefer steps that keep the walk near the middle.
    const opts = nb.map((d) => s + d).filter((t) => inR(t) && !used.has(t));
    if (!opts.length) { used.add(path.pop()); if (!path.length) path.push(s); continue; }
    path.push(opts[rng.int(opts.length)]);
    used.add(path[path.length - 1]);
  }
  const beads = [];
  for (const s of path) {
    const i = world.spawn(spDNA, s);
    world.frozen[i] = 1;
    beads.push(i);
  }
  return beads;
}

// The expressed gene set: the syn3A table plus one row for the rest of the
// genome, so ribosomes and polymerases carry their real load.
export function expressionTable() {
  const rows = GENES.map((g) => ({ ...g }));
  const copies = rows.reduce((a, g) => a + g.copies, 0);
  const mrna = rows.reduce((a, g) => a + g.mrna, 0);
  rows.push({
    id: 'other', name: 'Other genes', product: 'The rest of the proteome (about 430 genes), made as lumps of five proteins', role: 'other',
    loci: ['rest of genome'], start: -1, aa: OTHER_AA, copies: CELL.totalProteins - copies, mrna: CELL.totalMRNA - mrna,
  });
  const kDeg = LN2 / (CELL.mRNAHalfLifeMin * 60);
  const growth = LN2 / (CELL.doublingMin * 60);
  for (const g of rows) {
    g.kDeg = kDeg;
    // Translations per mRNA that keep the protein level through a doubling.
    g.burst = (g.copies * growth) / (g.mrna * kDeg);
    g.nt = 3 * g.aa + 60;
  }
  return rows;
}

// Builds species for machinery, gene products and DNA, and the per-step
// expression system. Returns a handle with counters and helpers.
export function setupExpression(world, { boost, share, sites, beads, spDNA, makeProduct, dilute = false, fixedMachinery = false, cal = CONTACT_CAL }) {
  const dt = world.dt;
  const rows = expressionTable();
  const idx = Object.fromEntries(rows.map((g, k) => [g.id, k]));
  const sp = {};
  const kDa = (g) => g.aa * MASS_PER_AA_KDA;
  sp.rnap = world.addSpecies({ name: 'rnap', label: 'RNA polymerase', D: diffusionFromMass(kDa(rows[idx.rnap])), size: 2, color: [0.36, 0.42, 0.9], radius: 0.36, gene: 'rnap' });
  sp.ribosome = world.addSpecies({ name: 'ribosome', label: 'Ribosome', D: diffusionFromMass(2300), size: 4, blocksSmall: true, color: [0.25, 0.27, 0.33], radius: 0.46, gene: 'ribosome' });
  sp.degradosome = world.addSpecies({ name: 'degradosome', label: 'RNase J degradosome', D: diffusionFromMass(kDa(rows[idx.rnj])), size: 1, color: [0.85, 0.22, 0.3], radius: 0.3, gene: 'rnj' });
  sp.mrna = world.addSpecies({ name: 'mrna', label: 'mRNA', D: MRNA_D, size: 2, color: [0.98, 0.7, 0.2], radius: 0.3 });
  sp.other = world.addSpecies({ name: 'other', label: 'Other proteins', D: diffusionFromMass(LUMP * 37), size: 2, color: [0.6, 0.62, 0.66], radius: 0.3, gene: 'other' });
  // Product species for each modelled gene (machinery rows make machinery).
  const product = rows.map((g) => {
    if (g.id === 'rnap') return sp.rnap;
    if (g.id === 'ribosome') return sp.ribosome;
    if (g.id === 'rnj') return sp.degradosome;
    if (g.id === 'other') return sp.other;
    const made = makeProduct?.(g);
    if (made !== undefined) return made;
    const m = kDa(g);
    return world.addSpecies({ name: 'p:' + g.id, label: g.name, D: diffusionFromMass(m), size: m > 150 ? 2 : 1, color: ROLE_COLOR[g.role] || [0.5, 0.5, 0.5], radius: m > 150 ? 0.32 : 0.24, gene: g.id });
  });

  // Promoters: each gene on the bead covering its genome position; "other
  // genes" spread over every bead.
  const nB = beads.length;
  const promoters = []; // { bead, gene, rate share }
  for (let k = 0; k < rows.length; k++) {
    const g = rows[k];
    if (g.id === 'other') {
      for (let b = 0; b < nB; b++) promoters.push({ bead: b, gene: k, share: 1 / nB });
    } else {
      promoters.push({ bead: Math.min(nB - 1, Math.floor((g.start / CELL.genomeBp) * nB)), gene: k, share: 1 });
    }
  }

  // Initial machinery and products at the slab's share of syn3A.
  const counts = rows.map((g) => Math.round(g.id === 'other' ? (g.copies * share) / LUMP : g.copies * share));

  // Per-contact chances, from a well-mixed estimate of how often a partner
  // is within the 5-site neighbourhood: rate = lambda/dt * N * 5 / sites.
  const nRnap = counts[idx.rnap], nRibo = counts[idx.ribosome], nDeg = counts[idx.rnj];
  // Expected ribosomes busy, so initiation is calibrated against free ones.
  const riboBusy = rows.reduce((a, g) => a + g.copies * share * (LN2 / (CELL.doublingMin * 60)) * (g.aa / PROCESS_RATES.translationAaPerS), 0);
  const rnapBusy = rows.reduce((a, g) => a + g.mrna * share * g.kDeg * (g.nt / PROCESS_RATES.transcriptionNtPerS), 0);
  const perContact = (rateCell, partners) => fix(Math.min(1, (rateCell * boost * dt * sites) / (5 * Math.max(partners, 0.5))));
  const pDeg = perContact(rows[0].kDeg * cal.deg, nDeg);
  const pTx = rows.map((g) => perContact(g.mrna * share * g.kDeg * cal.tx, Math.max(nRnap - rnapBusy, 1)));
  const pTl = rows.map((g) => perContact(g.burst * g.kDeg * cal.tl, Math.max(nRibo - riboBusy, 1)));
  const growth = LN2 / (CELL.doublingMin * 60);
  // Dilution stands in for growth in a cell that does not grow: each protein
  // particle leaves at the growth rate, so levels hold steady on average.
  const pDilute = fix(growth * boost * dt);
  const txSteps = rows.map((g) => Math.max(1, Math.round(g.nt / PROCESS_RATES.transcriptionNtPerS / boost / dt)));
  const tlSteps = rows.map((g) => Math.max(1, Math.round(g.aa / PROCESS_RATES.translationAaPerS / boost / dt)));

  const ex = {
    rows, idx, sp, product, promoters, counts, beads,
    pDeg, pTx, pTl, txSteps, tlSteps, riboBusy, rnapBusy,
    // live tallies
    mrnaNow: new Int32Array(rows.length),
    mrnaMade: new Float64Array(rows.length),
    protMade: new Float64Array(rows.length),
    protNow: new Int32Array(rows.length),
    otherCredit: 0,
    bursts: [],          // translations per finished mRNA (all genes)
    lifetimes: [],       // mRNA lifetimes, cell seconds
    lifetimeSum: 0, lifetimeN: 0, burstSum: 0, burstN: 0,
    nt: 0, aa: 0,        // nucleotides and amino acids polymerised (cell scale)
  };
  for (let k = 0; k < rows.length; k++) ex.protNow[k] = k === idx.other ? counts[k] * LUMP : counts[k];
  const rowOf = new Int32Array(world.species.length + 64).fill(-1);
  const machine = rows.map((g) => g.id === 'rnap' || g.id === 'ribosome' || g.id === 'rnj');
  rows.forEach((g, k) => { if (product[k] >= 0 && !(fixedMachinery && machine[k])) rowOf[product[k]] = k; });

  const nbr = [0, 1, -1, world.W, -world.W];
  const buf = new Int32Array(4);
  const W = world.W;

  // Free site for a new particle near s (rings out to radius 4).
  const placeNear = (spIndex, s) => {
    if (world.canPlace(spIndex, s)) return world.spawn(spIndex, s);
    for (let r = 1; r <= 4; r++) {
      const cands = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const t = s + dy * W + dx;
          if (t >= 0 && t < world.N && world.canPlace(spIndex, t)) cands.push(t);
        }
      }
      if (cands.length) return world.spawn(spIndex, cands[world.rng.int(cands.length)]);
    }
    return world.spawnRandom(spIndex);
  };
  ex.placeNear = placeNear;

  const finishProtein = (k, s) => {
    ex.protMade[k]++;
    ex.aa += rows[k].aa;
    if (k === idx.other) {
      ex.otherCredit++;
      if (ex.otherCredit < LUMP) return;
      ex.otherCredit = 0;
    }
    // In a cell that does not grow, machinery stays at syn3A levels: its
    // proteins are counted but no new machine is added.
    if (fixedMachinery && machine[k]) return;
    const i = placeNear(product[k], s);
    if (i >= 0) ex.protNow[k] += k === idx.other ? LUMP : 1;
    ex.onProduct?.(k, i);
  };

  world.systems.push(() => {
    const { alive, kind, pos, state, link, aux, prog, uid, frozen, rng } = world;
    // --- polymerases and ribosomes at work
    for (let i = 0; i < world.cap; i++) {
      if (!alive[i]) continue;
      const kd = kind[i];
      if (kd === sp.rnap && state[i] > 0) {
        if (--prog[i] > 0) continue;
        const k = state[i] - 1;
        const bead = link[i];
        state[i] = 0; frozen[i] = 0; link[i] = -1;
        if (bead >= 0 && alive[bead]) state[bead] = 0;
        const m = placeNear(sp.mrna, pos[i]);
        ex.mrnaMade[k]++;
        ex.nt += rows[k].nt;
        if (m >= 0) { aux[m] = k; prog[m] = 0; ex.mrnaNow[k]++; }
      } else if (kd === sp.ribosome && state[i] > 0) {
        if (--prog[i] > 0) continue;
        const k = state[i] - 1;
        const m = link[i];
        state[i] = 0; frozen[i] = 0; link[i] = -1;
        if (m >= 0 && alive[m] && uid[m] === aux[i]) {
          state[m]--;
          if (state[m] === 0) frozen[m] = 0;
        }
        finishProtein(k, pos[i]);
      }
    }
    // --- promoters: a free RNAP on or next to the bead may start
    for (const p of promoters) {
      const b = beads[p.bead];
      if (b < 0 || !alive[b] || state[b] > 0) continue;
      const pr = pTx[p.gene] * p.share;
      const s0 = pos[b];
      for (let d = 0; d < 5; d++) {
        const n = world.particlesAt(s0 + nbr[d], buf);
        for (let j = 0; j < n; j++) {
          const r = buf[j];
          if (kind[r] !== sp.rnap || state[r] > 0) continue;
          if (rng.next() < pr) {
            state[r] = p.gene + 1; frozen[r] = 1; link[r] = b; prog[r] = txSteps[p.gene];
            state[b] = 1;
            d = 5;
            break;
          }
        }
      }
    }
    // --- mRNAs: decay or a new ribosome, on contact
    for (let i = 0; i < world.cap; i++) {
      if (!alive[i] || kind[i] !== sp.mrna) continue;
      const k = aux[i];
      const s0 = pos[i];
      let dead = false;
      for (let d = 0; d < 5 && !dead; d++) {
        const n = world.particlesAt(s0 + nbr[d], buf);
        for (let j = 0; j < n; j++) {
          const r = buf[j];
          if (kind[r] === sp.degradosome) {
            if (rng.next() < pDeg) { dead = true; break; }
          } else if (kind[r] === sp.ribosome && state[r] === 0) {
            if (rng.next() < pTl[k]) {
              state[r] = k + 1; frozen[r] = 1; link[r] = i; aux[r] = uid[i]; prog[r] = tlSteps[k];
              state[i]++; frozen[i] = 1; prog[i]++;
            }
          }
        }
      }
      if (dead) {
        const life = (world.time - world.born[i]) * boost;
        ex.lifetimeSum += life; ex.lifetimeN++;
        ex.burstSum += prog[i]; ex.burstN++;
        ex.bursts.push(prog[i]);
        if (ex.bursts.length > 4000) ex.bursts.shift();
        ex.lifetimes.push(life);
        if (ex.lifetimes.length > 4000) ex.lifetimes.shift();
        ex.mrnaNow[k]--;
        world.kill(i);
      }
    }
    // --- dilution: one random slot per step gets a chance to leave, which
    // gives every protein particle the same per-step probability.
    if (dilute) {
      const pick = pDilute * world.cap;
      if (rng.next() < pick) {
        const i = rng.int(world.cap);
        const k = alive[i] ? rowOf[kind[i]] : -1;
        if (k >= 0 && !frozen[i] && state[i] === 0) {
          ex.protNow[k] -= k === idx.other ? LUMP : 1;
          world.kill(i);
        }
      }
    }
  });

  return ex;
}

export function createDogma(options = {}) {
  const opts = { ...DOGMA_DEFAULTS, ...options };
  const W = 48, H = 48, R = 20;
  const dt = 4e-6;
  const world = new World({ W, H, dt, seed: opts.seed, fieldEvery: 10 });
  const cx = W / 2, cy = H / 2;
  paintDisc(world, cx, cy, R);
  const sites = countSites(world, CYTO);
  const share = (sites * SITE_LITERS) / SYN3A_LITERS;
  const spDNA = world.addSpecies({ name: 'dna', label: 'Chromosome (10 kbp beads)', D: 0, size: 2, color: [0.55, 0.38, 0.62], radius: 0.4 });
  const beads = layChromosome(world, spDNA, cx, cy, DNA_BEADS, 8);
  const ex = setupExpression(world, { boost: opts.boost, share, sites, beads, spDNA, dilute: true, fixedMachinery: true });
  // Initial machinery and proteome. Contact chances stay calibrated to the
  // syn3A machinery level, so changing it changes the outcome.
  const scale = { ribosome: opts.ribosomes, rnj: opts.degradosomes };
  ex.rows.forEach((g, k) => {
    const n = Math.round(ex.counts[k] * (scale[g.id] ?? 1));
    let made = 0;
    for (let j = 0; j < n; j++) if (world.spawnRandom(ex.product[k]) >= 0) made++;
    if (scale[g.id] !== undefined) ex.protNow[k] = made;
  });
  const sc = { id: 'm3', world, opts, ex, sites, share, beads, boost: opts.boost, spDNA };

  // Copy-number history for the charts, sampled every 5 s of cell time.
  sc.history = [];
  sc.sampled = 0;     // samples taken since the watch began
  sc.epoch = 0;
  const every = Math.max(1, Math.round(5 / opts.boost / dt));
  const watchIdx = () => ex.idx[opts.watch] ?? ex.idx.gapDH;
  sc.sample = () => {
    const k = watchIdx();
    let total = 0;
    for (let j = 0; j < ex.rows.length; j++) total += ex.mrnaNow[j];
    sc.history.push([world.time * opts.boost, total, ex.mrnaNow[k], ex.protNow[k], ex.protMade[k]]);
    sc.sampled++;
    if (sc.history.length > 1500) sc.history.splice(0, sc.history.length - 1500);
  };
  sc.sample();
  sc.step = () => {
    world.step();
    if (world.stepCount % every === 0) sc.sample();
  };
  sc.setWatch = (id) => { opts.watch = id; sc.history.length = 0; sc.sampled = 0; sc.epoch++; sc.sample(); };
  return sc;
}
