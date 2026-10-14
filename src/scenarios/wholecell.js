// Milestone 4: a whole syn3A cell that grows, copies its chromosome and
// divides.
//
// Built on the central-dogma machinery (dogma.js), plus:
//   membrane growth  fatty acid enters through the membrane, FakAB turns it
//                    into acyl phosphate, PlsYC in the membrane turns that
//                    into lipid, all on encounter; the cell's area follows
//                    its lipid, so the disc stretches into a capsule;
//   replication      DnaA starts it on contact with the origin bead; two
//                    replisomes that reach the origin each take a fork and
//                    copy the chromosome one 10 kbp bead at a time at
//                    75 bp/s; copied genes are transcribed from both copies;
//   segregation      the two chromosomes are drawn towards opposite poles;
//   division         once the DNA is copied and segregated and the area has
//                    doubled, FtsZ that reaches midcell joins a Z ring, the
//                    ring pinches the cell in two, and everything on the far
//                    side of the cut leaves with the other daughter. The view
//                    then follows the remaining daughter into its next cycle.

import { World, CYTO, MEMBRANE, OUTSIDE } from '../core/world.js';
import { MM_PER_MOLECULE, SITE_LITERS, D_METABOLITE, calibrateBinding, catchmentRadius, fix } from '../core/units.js';
import { CELL, PROCESS_RATES, REACTIONS } from '../data/syn3a.js';
import { SYN3A_LITERS } from './common.js';
import { layChromosome, setupExpression, D_MEMBRANE } from './dogma.js';

export const CELL_DEFAULTS = {
  seed: 1,
  boost: 1000,
  fattyAcid: 1,      // medium fatty acid, multiple of the default supply
};

const W = 100, H = 50;
const R = 20;                     // cell radius, sites (200 nm)
const DT = 4e-6;
const DNA_BEADS = 54;
const LIPIDS_PER_SITE = 23;       // lipids per site of cell area (see README)
const UPTAKE = 37;                // fatty acids per membrane site per second, boosted
const NECK_SLOPE = 1.2;           // how sharp the division furrow is
const CONSTRICT_S = 600;          // cell seconds for a full ring to pinch the cell
const RING_FULL = 8;              // FtsZ in the ring for full constriction speed
const INIT_WAIT_S = 300;          // mean wait for DnaA to open the origin, well mixed
const SAMPLE_S = 10;              // chart sample interval, cell seconds
const MRNA_FLOOR = 0.2;           // least mRNAs per gene in the cell (see setupExpression)

const LIPID_STEPS = { fak: 'FAK', pls: 'APG3PAT' };
// Where each bead settles in a segregated nucleoid: a sunflower spiral of
// radius 6 sites around the nucleoid's centre.
const HOME = Array.from({ length: DNA_BEADS }, (_, j) => {
  const a = j * 2.39996, rad = 6 * Math.sqrt((j + 0.5) / DNA_BEADS);
  return [Math.round(rad * Math.cos(a)), Math.round(rad * Math.sin(a))];
});

// ------------------------------------------------------------------ shape
// A capsule: a rectangle of half-length L capped by half-discs of radius r,
// centred at (cx, cy), with an optional division furrow at x = cx whose
// depth leaves a neck of radius `neck`.
function insideShape(sh, px, py) {
  const ax = Math.max(sh.cx - sh.L, Math.min(sh.cx + sh.L, px));
  const dx = px - ax, dy = py - sh.cy;
  let rr = sh.r;
  if (sh.neck < sh.r) rr = Math.min(rr, sh.neck + NECK_SLOPE * Math.abs(px - sh.cx));
  return rr > 0 && dx * dx + dy * dy <= rr * rr;
}

export function paintShape(sh) {
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) inside[y * W + x] = insideShape(sh, x + 0.5, y + 0.5) ? 1 : 0;
  const site = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const s = y * W + x;
      if (!inside[s]) continue;
      site[s] = inside[s - 1] && inside[s + 1] && inside[s - W] && inside[s + W] ? CYTO : MEMBRANE;
    }
  }
  return site;
}

const areaOf = (site) => { let n = 0; for (let s = 0; s < site.length; s++) if (site[s] !== OUTSIDE) n++; return n; };

// Re-lay the world onto new site types, shifting everything by dx columns.
// Particles keep their index (so links stay valid) and go to the shifted
// site, or the nearest one that fits. Field contents follow the shift; what
// would land outside is spread over the cell.
export function relayout(world, site, dx = 0, order = null) {
  const { N } = world;
  const CAP = 4;
  const live = [];
  for (let i = 0; i < world.cap; i++) if (world.alive[i]) live.push(i);
  // Frozen particles first (DNA, polymerases on genes), then big ones.
  const rank = (i) => (order ? order(i) : 0) * 10 + (world.frozen[i] ? 0 : 1) * 5 - world.species[world.kind[i]].size;
  live.sort((a, b) => rank(a) - rank(b) || a - b);
  const want = new Int32Array(world.cap).fill(-1);
  for (const i of live) want[i] = world.pos[i] + dx;
  world.slots.fill(-1);
  world.occ.fill(0);
  world.block.fill(0);
  world.site.set(site);
  // Fields: shift, and spread anything left outside evenly over the cell.
  const FS = world.fields;
  const inside = areaOf(site);
  for (let k = 0; k < FS.data.length; k++) {
    const f = FS.data[k];
    const g = new Float64Array(N);
    let lost = 0;
    for (let s = 0; s < N; s++) {
      if (f[s] === 0) continue;
      const t = s + dx;
      if (t >= 0 && t < N && site[t] !== OUTSIDE) g[t] += f[s];
      else lost += f[s];
    }
    lost += FS.stash[k];
    FS.stash[k] = 0;
    if (lost !== 0) { const per = lost / inside; for (let s = 0; s < N; s++) if (site[s] !== OUTSIDE) g[s] += per; }
    f.set(g);
    FS.fresh[k].fill(0);
  }
  FS.freshList.length = 0;
  let lostParticles = 0;
  for (const i of live) {
    const sp = world.species[world.kind[i]];
    let t = want[i];
    const fits = (u) => u >= 0 && u < N && world.site[u] === sp.compartment && world.occ[u] + sp.size <= CAP;
    if (!(t >= 0 && t < N) || !fits(t)) t = nearestFit(world, want[i], fits);
    if (t < 0) { world.alive[i] = 0; world.pos[i] = -1; world.freeList.push(i); world.count--; lostParticles++; continue; }
    world.pos[i] = -1;
    world._enter(i, t);
    if (sp.blocksSmall) FS.flushNear(t);
  }
  world.touchSites();
  return lostParticles;
}

function nearestFit(world, s, fits) {
  const Wd = world.W;
  const x0 = ((s % Wd) + Wd) % Wd, y0 = Math.floor(s / Wd);
  for (let r = 1; r < 40; r++) {
    // Ring of Chebyshev radius r, scanned in a fixed order.
    for (let dy = -r; dy <= r; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= world.H) continue;
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        const x = x0 + dx;
        if (x < 0 || x >= Wd) continue;
        const t = y * Wd + x;
        if (fits(t)) return t;
      }
    }
  }
  return -1;
}

// ------------------------------------------------------------------ cell
export function createWholeCell(options = {}) {
  const opts = { ...CELL_DEFAULTS, ...options };
  const B = opts.boost;
  const world = new World({ W, H, dt: DT, seed: opts.seed, fieldEvery: 10 });
  const cx = W / 2, cy = H / 2;
  const shape = { cx, cy, r: R, L: 0, neck: Infinity };
  world.site.set(paintShape(shape));
  world.touchSites();
  const A0 = areaOf(world.site);
  let cytoSites = 0;
  for (let s = 0; s < world.N; s++) if (world.site[s] === CYTO) cytoSites++;
  const share = (cytoSites * SITE_LITERS) / SYN3A_LITERS;

  // Lipid precursors. Lipid synthesis is part of growth, so it runs boosted
  // like transcription and translation: its enzymes keep their measured Km
  // and turn over `boost` times faster.
  const F = {
    fa: world.fields.add({ name: 'fa', label: 'Fatty acid', D: D_METABOLITE, init: 0, max: 0.004 }),
    ap: world.fields.add({ name: 'ap', label: 'Acyl phosphate', D: D_METABOLITE, init: 0, max: 0.004 }),
  };

  const spDNA = world.addSpecies({ name: 'dna', label: 'Chromosome (10 kbp beads)', D: 0, size: 2, color: [0.55, 0.38, 0.62], radius: 0.4 });
  const beads = layChromosome(world, spDNA, cx, cy, DNA_BEADS, 8);
  const lipidSp = {};
  const makeProduct = (g) => {
    const rxn = LIPID_STEPS[g.id];
    if (!rxn) return undefined;
    const r = REACTIONS[rxn];
    const membrane = !!g.membrane;
    const D = membrane ? D_MEMBRANE : 1.5;
    const sp = world.addSpecies({
      name: 'p:' + g.id, label: g.name, D, size: 2, compartment: membrane ? MEMBRANE : CYTO,
      color: membrane ? [0.95, 0.75, 0.2] : [0.85, 0.6, 0.15], radius: 0.34, gene: g.id,
    });
    const kcat = r.kcat * B;
    const copies = Math.max(1, Math.round(g.copies * share));
    // FakAB and PlsYC each have one modelled substrate; ATP and glycerol
    // 3-phosphate are taken as saturating.
    const Km = rxn === 'FAK' ? r.Km[1] : r.Km[0];
    const cal = calibrateBinding({ kcat, KmMilli: Km, kon: Math.max(1e7, (2 * kcat) / (Km * 1e-3)), D: D_METABOLITE + D, bSites: catchmentRadius(A0, copies) });
    world.setEnzyme(sp, { subs: [rxn === 'FAK' ? F.fa : F.ap], prods: rxn === 'FAK' ? [F.ap] : [], kSite: [cal.kSite], koff: [cal.koff], kcat });
    lipidSp[g.id] = sp;
    return sp;
  };
  const ex = setupExpression(world, { boost: B, share, sites: cytoSites, beads, spDNA, makeProduct, dilute: false, fixedMachinery: false, mrnaFloor: MRNA_FLOOR });
  ex.rows.forEach((g, k) => {
    let made = 0;
    for (let j = 0; j < ex.counts[k]; j++) if (world.spawnRandom(ex.product[k]) >= 0) made++;
    if (g.id !== 'other') ex.protNow[k] = made;
  });
  ex.seedMRNA();
  const spOf = (id) => ex.product[ex.idx[id]];
  const SP = { dnaA: spOf('dnaA'), rep: spOf('replisome'), ftsZ: spOf('ftsZ'), pls: lipidSp.pls, fak: lipidSp.fak };

  // ---------------------------------------------------------------- state
  const cell = {
    cycle: 1,
    born: 0,                 // cell time of birth, s
    lipids: A0 * LIPIDS_PER_SITE,
    lipidEvents: 0,
    area: A0,
    phase: 'growing',
    divisions: [],           // { t, cycleTime, partition }
  };
  const rep = {
    started: false, initAt: -1, forks: [], done: false, doneAt: -1,
    chrom: beads.slice(),    // genome-ordered bead particles of the kept chromosome
    copy: new Int32Array(DNA_BEADS).fill(-1),
    copyUid: new Int32Array(DNA_BEADS),
  };
  const ring = { licensed: false, members: [], at: -1 };

  const nbr = [0, 1, -1, W, -W];
  const buf = new Int32Array(4);
  const stepsPerBead = Math.round((CELL.genomeBp / DNA_BEADS) / PROCESS_RATES.forkBpPerS / B / DT);
  // Same well-mixed contact estimate as the expression system.
  const nDnaA = Math.max(1, ex.counts[ex.idx.dnaA]);
  const pInit = fix(Math.min(1, ((1 / INIT_WAIT_S) * B * DT * cytoSites) / (5 * nDnaA)));
  const pLoad = 0.05;
  const pRing = 0.02;
  const pSeg = 0.25;

  const isCopied = (j) => rep.copy[j] >= 0 && world.alive[rep.copy[j]] && world.uid[rep.copy[j]] === rep.copyUid[j];

  // ---------------------------------------------------------------- replication
  const contactWith = (s0, spIndex, free) => {
    for (let d = 0; d < 5; d++) {
      const n = world.particlesAt(s0 + nbr[d], buf);
      for (let j = 0; j < n; j++) {
        const r = buf[j];
        if (world.kind[r] === spIndex && (!free || (world.state[r] === 0 && !world.frozen[r]))) return r;
      }
    }
    return -1;
  };
  const parkNear = (i, s) => {
    // Move a frozen machine next to bead site s if there is room.
    const sp = world.species[world.kind[i]];
    for (let d = 1; d < 5; d++) {
      const t = s + nbr[d];
      if (t === world.pos[i]) return;
      if (world.site[t] === sp.compartment && world.occ[t] + sp.size <= 4) { world.moveTo(i, t); return; }
    }
  };

  world.systems.push(() => {
    const { rng } = world;
    const ori = rep.chrom[0];
    if (!rep.started) {
      const a = contactWith(world.pos[ori], SP.dnaA, true);
      if (a >= 0 && rng.next() < pInit) { rep.started = true; rep.initAt = world.time * B; }
    } else if (rep.forks.length < 2) {
      const r = contactWith(world.pos[ori], SP.rep, true);
      if (r >= 0 && rng.next() < pLoad) {
        const cw = rep.forks.length === 0;
        world.frozen[r] = 1; world.state[r] = 1;
        rep.forks.push({ i: r, j: cw ? 0 : DNA_BEADS - 1, dir: cw ? 1 : -1, last: cw ? DNA_BEADS / 2 - 1 : DNA_BEADS / 2, prog: stepsPerBead, done: false });
      }
    }
    for (const f of rep.forks) {
      if (f.done) continue;
      if (--f.prog > 0) continue;
      const parent = rep.chrom[f.j];
      const c = ex.placeNear(spDNA, world.pos[parent]);
      if (c >= 0) {
        world.frozen[c] = 1;
        world.aux[c] = f.j;
        rep.copy[f.j] = c;
        rep.copyUid[f.j] = world.uid[c];
        ex.addPromoters(f.j, c);
      }
      if (f.j === f.last) {
        f.done = true;
        world.frozen[f.i] = 0; world.state[f.i] = 0;
        if (rep.forks.length === 2 && rep.forks.every((x) => x.done)) { rep.done = true; rep.doneAt = world.time * B; }
      } else {
        f.j += f.dir;
        f.prog = stepsPerBead;
        parkNear(f.i, world.pos[rep.chrom[f.j]]);
      }
    }

    // ---- segregation: copied beads are drawn to opposite poles, each to
    // its own spot in a compact nucleoid there.
    if (rep.started && rng.next() < pSeg) {
      const j = rng.int(DNA_BEADS);
      const half = Math.max(4, (shape.L + shape.r) / 2 - 1);
      const which = rng.next() < 0.5 || !isCopied(j) ? 0 : 1;
      const i = which === 0 ? rep.chrom[j] : rep.copy[j];
      const tx = (!isCopied(j) ? cx : which === 0 ? cx - half : cx + half) + HOME[j][0];
      const ty = cy + HOME[j][1];
      const s = world.pos[i];
      const ddx = tx - ((s % W) + 0.5), ddy = ty - (Math.floor(s / W) + 0.5);
      let t = -1;
      if (Math.abs(ddx) > 1 && Math.abs(ddx) >= Math.abs(ddy)) {
        t = s + (ddx > 0 ? 1 : -1);
        // Blocked (often by the other chromosome coming the other way):
        // step sideways to get round it.
        if (!world.canPlace(spDNA, t)) t = s + (rng.next() < 0.5 ? W : -W);
      } else if (Math.abs(ddy) > 1) t = s + (ddy > 0 ? W : -W);
      if (t >= 0 && world.canPlace(spDNA, t)) world.moveTo(i, t);
    }

    // ---- lipid growth
    const ev = world.events[SP.pls];
    if (ev !== cell.lipidEvents) { cell.lipids += ev - cell.lipidEvents; cell.lipidEvents = ev; }

    // ---- Z ring
    if (!ring.licensed && rep.done && cell.area >= 2 * A0 && segregated()) {
      ring.licensed = true;
      ring.at = world.time * B;
      cell.phase = 'dividing';
    }
    if (ring.licensed) {
      // FtsZ that reaches the membrane at midcell joins the ring.
      for (let y = 1; y < H - 1; y++) {
        for (const x of [cx - 1, cx]) {
          const s = y * W + x;
          if (world.site[s] !== CYTO) continue;
          if (world.site[s - W] !== MEMBRANE && world.site[s + W] !== MEMBRANE && world.site[s - 1] !== MEMBRANE && world.site[s + 1] !== MEMBRANE) continue;
          const n = world.particlesAt(s, buf);
          for (let k = 0; k < n; k++) {
            const z = buf[k];
            if (world.kind[z] === SP.ftsZ && world.state[z] === 0 && rng.next() < pRing) {
              world.state[z] = 1; world.frozen[z] = 1; ring.members.push(z);
            }
          }
        }
      }
      const rate = Math.min(1, ring.members.length / RING_FULL);
      if (rate > 0) shape.neck = Math.min(shape.neck, shape.r) - (shape.r / (CONSTRICT_S / B / DT)) * rate;
    }
  });

  function segregated() {
    for (let j = 0; j < DNA_BEADS; j++) {
      if (((world.pos[rep.chrom[j]] % W) + 0.5) > cx - 0.5) return false;
      if (!isCopied(j) || ((world.pos[rep.copy[j]] % W) + 0.5) < cx + 0.5) return false;
    }
    return true;
  }

  // Fatty acid uptake through every membrane site, at field updates.
  const Dt = world.fieldEvery * DT;
  world.onFieldUpdate = () => {
    const add = fix(UPTAKE * opts.fattyAcid * Dt * MM_PER_MOLECULE);
    const f = world.fields.data[F.fa];
    for (let s = 0; s < world.N; s++) if (world.site[s] === MEMBRANE && world.block[s] === 0) f[s] += add;
  };

  // ---------------------------------------------------------------- reshaping
  const A_DISC = A0;
  let painted = { L: 0, neck: Infinity };
  const reshape = () => {
    const target = cell.lipids / LIPIDS_PER_SITE;
    // Lengthen the capsule so its area matches the lipid it has made.
    let L = shape.L;
    const Lwant = Math.max(0, (target - A_DISC) / (4 * shape.r));
    if (ring.licensed) L = Math.max(L, Lwant); else L = Lwant;
    const neckMoved = shape.neck < shape.r && (painted.neck === Infinity ? shape.neck < shape.r - 0.5 : painted.neck - shape.neck >= 0.5);
    if (Math.abs(L - painted.L) < 0.25 && !neckMoved) return;
    shape.L = L;
    relayout(world, paintShape(shape), 0);
    painted = { L, neck: shape.neck };
    cell.area = areaOf(world.site);
    if (shape.neck <= 0.05) divide();
  };

  function divide() {
    const t = world.time * B;
    // Count what each daughter gets, then let the right one go.
    const part = {};
    const tally = (name, side) => { (part[name] = part[name] || [0, 0])[side]++; };
    const sumX = { n: 0, x: 0 };
    for (let i = 0; i < world.cap; i++) {
      if (!world.alive[i]) continue;
      const x = (world.pos[i] % W) + 0.5;
      const side = x < cx ? 0 : 1;
      tally(world.species[world.kind[i]].name, side);
      if (side === 1) {
        // A machine working on something that leaves goes with it.
        world.kill(i);
      }
    }
    let leftSites = 0, total = 0;
    for (let s = 0; s < world.N; s++) {
      if (world.site[s] === OUTSIDE) continue;
      total++;
      const x = (s % W) + 0.5;
      if (x < cx) { leftSites++; sumX.n++; sumX.x += x; }
    }
    cell.lipids *= leftSites / total;
    // Release the ring and anything left bound to a partner that is gone.
    for (const z of ring.members) if (world.alive[z]) { world.state[z] = 0; world.frozen[z] = 0; }
    ring.members.length = 0;
    fixDangling();
    ex.prunePromoters();
    // Recentre the daughter and round it up.
    const dx = Math.round(cx - sumX.x / sumX.n);
    shape.neck = Infinity;
    shape.L = Math.max(0, (cell.lipids / LIPIDS_PER_SITE - A_DISC) / (4 * shape.r));
    relayout(world, paintShape(shape), dx);
    painted = { L: shape.L, neck: Infinity };
    cell.area = areaOf(world.site);
    cell.divisions.push({ t, cycleTime: t - cell.born, partition: part, cycle: cell.cycle });
    cell.cycle++;
    cell.born = t;
    cell.phase = 'growing';
    rep.started = false; rep.initAt = -1; rep.forks = []; rep.done = false; rep.doneAt = -1;
    rep.copy.fill(-1);
    ring.licensed = false; ring.at = -1;
    sc.onDivide?.(cell.divisions[cell.divisions.length - 1]);
  }

  // After a cut, machines bound to something that left are set free, and
  // an mRNA whose ribosomes left is unfrozen.
  function fixDangling() {
    const { alive, kind, state, link, frozen, uid, aux } = world;
    for (let i = 0; i < world.cap; i++) {
      if (!alive[i]) continue;
      const kd = kind[i];
      if (kd === ex.sp.ribosome && state[i] > 0) {
        const m = link[i];
        if (m < 0 || !alive[m] || uid[m] !== aux[i]) { /* finishes its protein */ }
      } else if (kd === ex.sp.rnap && state[i] > 0) {
        const b = link[i];
        if (b < 0 || !alive[b]) { /* finishes its transcript */ }
      } else if (kd === ex.sp.mrna) {
        // Recount ribosomes still on it.
        state[i] = 0;
      }
    }
    for (let i = 0; i < world.cap; i++) {
      if (!alive[i] || kind[i] !== ex.sp.ribosome || state[i] === 0) continue;
      const m = link[i];
      if (m >= 0 && alive[m] && uid[m] === aux[i]) state[m]++;
    }
    for (let i = 0; i < world.cap; i++) if (alive[i] && kind[i] === ex.sp.mrna) frozen[i] = state[i] > 0 ? 1 : 0;
    // Recount mRNAs per gene and proteins per gene from what is left.
    ex.mrnaNow.fill(0);
    ex.protNow.fill(0);
    const rowOfSp = new Map(ex.product.map((spi, k) => [spi, k]));
    for (let i = 0; i < world.cap; i++) {
      if (!alive[i]) continue;
      if (kind[i] === ex.sp.mrna) ex.mrnaNow[aux[i]]++;
      else if (rowOfSp.has(kind[i])) {
        const k = rowOfSp.get(kind[i]);
        ex.protNow[k] += ex.rows[k].id === 'other' ? 5 : 1;
      }
    }
  }

  // ---------------------------------------------------------------- history
  const sc = { id: 'm4', world, opts, ex, cell, rep, ring, shape, F, SP, A0, share, boost: B, spDNA, LIPIDS_PER_SITE };
  sc.history = [];
  sc.sampled = 0;
  const every = Math.max(1, Math.round(SAMPLE_S / B / DT));
  sc.copied = () => { let n = 0; for (let j = 0; j < DNA_BEADS; j++) if (isCopied(j)) n++; return n / DNA_BEADS; };
  sc.proteins = () => {
    let n = 0;
    for (let k = 0; k < ex.rows.length; k++) n += ex.protNow[k];
    return n;
  };
  sc.countOf = (spIndex) => { let n = 0; for (let i = 0; i < world.cap; i++) if (world.alive[i] && world.kind[i] === spIndex) n++; return n; };
  sc.sample = () => {
    let m = 0;
    for (const v of ex.mrnaNow) m += v;
    sc.history.push([world.time * B, cell.area / A0, sc.copied(), sc.proteins(), m, ring.members.length, cell.cycle]);
    sc.sampled++;
    if (sc.history.length > 2000) sc.history.splice(0, sc.history.length - 2000);
  };
  sc.sample();
  sc.step = () => {
    world.step();
    if ((world.stepCount & 63) === 0) reshape();
    if (world.stepCount % every === 0) sc.sample();
  };
  sc.phase = () => {
    if (ring.licensed) return ring.members.length ? 'constricting' : 'Z ring assembling';
    if (rep.done) return cell.area >= 2 * A0 ? 'segregating' : 'growing, DNA copied';
    if (rep.started) return rep.forks.length < 2 ? 'loading replisomes' : 'copying DNA';
    return 'growing, waiting for DnaA';
  };
  return sc;
}
