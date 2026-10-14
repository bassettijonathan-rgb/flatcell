// The lattice world: sites, particles, concentration fields and the step loop.
//
// Sites are 10 nm squares. Each site has a type (outside, membrane,
// cytoplasm) and holds up to SLOTS_PER_SITE slots of particles; small
// proteins take one slot, large complexes take all four. Particles hop to a
// random neighbour with a probability set by their diffusion coefficient and
// are blocked by full sites, which is all "crowding" is in this model.

import { makeRng, probFromRate, negLog, hashNumbers } from './rng.js';
import { hopProbability, SLOTS_PER_SITE, MM_PER_MOLECULE, fix } from './units.js';
import { FieldSet } from './fields.js';

export const OUTSIDE = 0;
export const MEMBRANE = 1;
export const CYTO = 2;

const CAP = SLOTS_PER_SITE;
const SUB_SLOTS = 4; // most substrates one enzyme binds in sequence

export class World {
  constructor({ W, H, dt, seed = 1, boost = 1, fieldEvery = 10 }) {
    this.W = W;
    this.H = H;
    this.N = W * H;
    this.dt = dt;              // seconds of physical time per step
    this.boost = boost;        // speed-up of slow processes (see README)
    this.fieldEvery = fieldEvery;
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.stepCount = 0;
    this.time = 0;

    this.site = new Uint8Array(this.N);
    this.region = new Uint8Array(this.N);   // scenario-defined labels
    this.occ = new Uint8Array(this.N);      // slots used
    this.block = new Uint8Array(this.N);    // particles that exclude small molecules
    this.slots = new Int32Array(this.N * CAP).fill(-1);
    this.siteVersion = 0;

    this.species = [];
    this.cap = 0;
    this.count = 0;
    this.nextUid = 1;
    this.freeList = [];
    this._alloc(256);

    this.fields = new FieldSet(this);
    this.systems = [];        // per-step functions (world) => void
    this.events = new Float64Array(64); // per-species catalysis counters
  }

  // ---------------------------------------------------------------- species
  addSpecies(def) {
    const sp = {
      name: def.name,
      label: def.label || def.name,
      D: def.D || 0,
      size: def.size || 1,
      compartment: def.compartment ?? CYTO,
      blocksSmall: !!def.blocksSmall,
      color: def.color || [0.6, 0.6, 0.6],
      radius: def.radius || (def.size === 4 ? 0.48 : def.size === 2 ? 0.34 : 0.26),
      bonded: !!def.bonded,
      gene: def.gene || null,
      enzyme: null,
      index: this.species.length,
      pHop: 0,
    };
    sp.pHop = Math.min(1, hopProbability(sp.D, this.dt));
    this.species.push(sp);
    if (this.events.length < this.species.length) {
      const e = new Float64Array(this.species.length * 2);
      e.set(this.events);
      this.events = e;
    }
    return sp.index;
  }

  setDiffusion(spIndex, D) {
    const sp = this.species[spIndex];
    sp.D = D;
    sp.pHop = Math.min(1, hopProbability(D, this.dt));
  }

  // Attach Michaelis-Menten encounter kinetics to a species. Substrates bind
  // one at a time in the listed order (ordered sequential mechanism);
  // kSite[i] is the per-site association rate (M^-1 s^-1) for substrate i,
  // koff[i] its dissociation rate (1/s). When all are bound the complex
  // turns over at kcat and releases the products into the enzyme's site.
  setEnzyme(spIndex, { subs, prods, kSite, koff, kcat, stoich }) {
    const dt = this.dt;
    const n = subs.length;
    if (n > SUB_SLOTS) throw new Error(`at most ${SUB_SLOTS} substrates per enzyme`);
    const fastest = Math.max(...koff.map((k) => (k + kcat) * dt), ...kSite.map((k) => k * 1e-3 * dt * MM_PER_MOLECULE));
    const sub = Math.max(1, Math.ceil(fastest / 0.2));
    this.species[spIndex].enzyme = {
      subs: Int32Array.from(subs),
      prods: Int32Array.from(prods),
      kSiteDt: Float64Array.from(kSite.map((k) => fix(k * 1e-3 * dt))), // per mM per step
      koffDt: Float64Array.from(koff.map((k) => fix(k * dt))),
      kcatDt: fix(kcat * dt),
      // Unimolecular steps faster than ~0.2 per step are resolved with
      // substeps, so very fast binding/unbinding keeps the right balance.
      sub,
      // Capture rate (per substep) of the substrate visible in the site.
      lam: Float64Array.from(kSite.map((k) => fix(k * 1e-3 * dt * MM_PER_MOLECULE) / sub)),
      // Per-substate cache of the share captured in one full substep; it
      // depends on how fast each substrate field refills (fields.hide).
      decay: new Float64Array(n),
      decayVersion: -1,
      n,
      stoich: stoich ? Float64Array.from(stoich) : null,
    };
  }

  // ---------------------------------------------------------------- particles
  _alloc(newCap) {
    const growBy = (Arr, old, len) => {
      const a = new Arr(len);
      if (old) a.set(old);
      return a;
    };
    const grow = (Arr, old, fill) => {
      const a = new Arr(newCap);
      if (old) a.set(old);
      if (fill !== undefined) a.fill(fill, old ? old.length : 0);
      return a;
    };
    this.pos = grow(Int32Array, this.pos, -1);
    this.kind = grow(Uint16Array, this.kind);
    this.state = grow(Uint8Array, this.state);
    this.alive = grow(Uint8Array, this.alive);
    this.frozen = grow(Uint8Array, this.frozen);
    this.uid = grow(Int32Array, this.uid);
    this.link = grow(Int32Array, this.link, -1);   // bound partner
    this.aux = grow(Int32Array, this.aux, -1);     // scenario payload (gene id ...)
    this.prog = grow(Float64Array, this.prog);     // progress counter
    this.born = grow(Float64Array, this.born);
    // Substrate an enzyme has drawn from the field towards its next binding
    // (one slot per substrate), and the amount that triggers the binding.
    this.credit = growBy(Float64Array, this.credit, newCap * SUB_SLOTS);
    this.need = growBy(Float64Array, this.need, newCap * SUB_SLOTS);
    for (let i = newCap - 1; i >= this.cap; i--) this.freeList.push(i);
    this.cap = newCap;
  }

  canPlace(spIndex, s) {
    const sp = this.species[spIndex];
    return this.site[s] === sp.compartment && this.occ[s] + sp.size <= CAP;
  }

  // Create a particle at site s. Returns its index, or -1 if it does not fit.
  spawn(spIndex, s) {
    if (!this.canPlace(spIndex, s)) return -1;
    if (this.freeList.length === 0) this._alloc(this.cap * 2);
    const i = this.freeList.pop();
    this.alive[i] = 1;
    this.kind[i] = spIndex;
    this.state[i] = 0;
    this.frozen[i] = 0;
    this.link[i] = -1;
    this.aux[i] = -1;
    this.prog[i] = 0;
    this.born[i] = this.time;
    for (let j = i * SUB_SLOTS; j < (i + 1) * SUB_SLOTS; j++) { this.credit[j] = 0; this.need[j] = 0; }
    this.uid[i] = this.nextUid++;
    this.pos[i] = -1;
    this._enter(i, s);
    if (this.species[spIndex].blocksSmall) this.fields.flushNear(s);
    this.count++;
    return i;
  }

  // Place a particle at a random free site of its compartment.
  spawnRandom(spIndex, filter, tries = 4000) {
    const comp = this.species[spIndex].compartment;
    for (let t = 0; t < tries; t++) {
      const s = this.rng.int(this.N);
      if (this.site[s] !== comp) continue;
      if (filter && !filter(s)) continue;
      const i = this.spawn(spIndex, s);
      if (i >= 0) return i;
    }
    return -1;
  }

  kill(i) {
    if (!this.alive[i]) return;
    // Captured-but-unbound substrate goes back where it came from.
    const ez = this.species[this.kind[i]].enzyme;
    if (ez) {
      for (let j = 0; j < ez.n; j++) {
        const c = this.credit[i * SUB_SLOTS + j];
        if (c !== 0) this.fields.data[ez.subs[j]][this.pos[i]] += c;
      }
    }
    this._leave(i, this.pos[i]);
    this.alive[i] = 0;
    this.pos[i] = -1;
    this.link[i] = -1;
    this.freeList.push(i);
    this.count--;
  }

  _enter(i, s) {
    const sp = this.species[this.kind[i]];
    const base = s * CAP;
    for (let k = 0; k < CAP; k++) {
      if (this.slots[base + k] === -1) { this.slots[base + k] = i; break; }
    }
    this.occ[s] += sp.size;
    if (sp.blocksSmall) {
      if (this.block[s] === 0) { this.fields.pushOut(s); this.fields.dirty = true; }
      this.block[s]++;
    }
    this.pos[i] = s;
  }

  _leave(i, s) {
    const sp = this.species[this.kind[i]];
    const base = s * CAP;
    for (let k = 0; k < CAP; k++) {
      if (this.slots[base + k] === i) { this.slots[base + k] = -1; break; }
    }
    this.occ[s] -= sp.size;
    if (sp.blocksSmall && --this.block[s] === 0) this.fields.dirty = true;
  }

  // Move particle i to site t (no checks).
  moveTo(i, t) {
    const s = this.pos[i];
    const sp = this.species[this.kind[i]];
    const slots = this.slots;
    const bs = s * CAP, bt = t * CAP;
    for (let k = 0; k < CAP; k++) if (slots[bs + k] === i) { slots[bs + k] = -1; break; }
    for (let k = 0; k < CAP; k++) if (slots[bt + k] === -1) { slots[bt + k] = i; break; }
    this.occ[s] -= sp.size;
    this.occ[t] += sp.size;
    this.pos[i] = t;
    if (sp.blocksSmall) {
      const block = this.block;
      block[s]--;
      const wasOpen = block[t] === 0;
      block[t]++;
      if (wasOpen) {
        // Small molecules displaced from t go to the site the blocker left,
        // or to the nearest open site if that one is still blocked.
        const FS = this.fields;
        if (block[s] === 0) {
          const F = FS.data, fr = FS.fresh;
          for (let k = 0; k < F.length; k++) {
            F[k][s] += F[k][t];
            F[k][t] = 0;
            fr[k][t] = 0;
          }
        } else {
          FS.pushOut(t);
          FS.flushNear(t);
        }
        FS.dirty = true;
      } else if (block[s] === 0) {
        this.fields.dirty = true;
      }
    }
  }

  // Particles at site s (up to 4), written into out; returns how many.
  particlesAt(s, out) {
    let n = 0;
    const base = s * CAP;
    for (let k = 0; k < CAP; k++) {
      const j = this.slots[base + k];
      if (j >= 0) out[n++] = j;
    }
    return n;
  }

  // ---------------------------------------------------------------- stepping
  diffuseParticles() {
    const { alive, kind, frozen, pos, site, occ, species, rng } = this;
    const W = this.W;
    const off0 = 1, off1 = -1, off2 = W, off3 = -W;
    const n = this.cap;
    const start = rng.int(n);
    const reverse = this.stepCount & 1;
    for (let k = 0; k < n; k++) {
      let i = start + k;
      if (i >= n) i -= n;
      if (reverse) i = n - 1 - i;
      if (!alive[i] || frozen[i]) continue;
      const sp = species[kind[i]];
      const p = sp.pHop;
      if (p === 0) continue;
      const r = rng.next();
      if (r >= p) continue;
      const d = ((r / p) * 4) | 0;
      const s = pos[i];
      const t = s + (d === 0 ? off0 : d === 1 ? off1 : d === 2 ? off2 : off3);
      if (site[t] !== sp.compartment) continue;
      if (occ[t] + sp.size > CAP) continue;
      if (sp.bonded && !this.bondCheck(i, t)) continue;
      this.moveTo(i, t);
      if (sp.bonded) this.afterBondedMove(i, s, t);
    }
  }

  // Overridden by scenarios with polymers (DNA).
  bondCheck() { return true; }
  afterBondedMove() {}

  // Encounter kinetics for every enzyme particle against the fields in its
  // own site. Each enzyme is a small Markov chain: state k means the first k
  // substrates are bound. Binding happens at kSite * [S] (only while the
  // substrate is actually in the site), unbinding at koff, turnover at kcat.
  // Each enzyme is a small Markov chain over how many substrates it holds,
  // run in continuous time inside each substep: when a transition happens,
  // the rest of the substep carries on in the new state, so dwell times have
  // the right means however coarse the time step.
  enzymeKinetics() {
    const { alive, kind, pos, state, species, rng, events, credit, need } = this;
    const FS = this.fields;
    const F = FS.data;
    const fresh = FS.fresh;
    const hide = FS.hide;
    const q = MM_PER_MOLECULE;
    const n = this.cap;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const sp = species[kind[i]];
      const ez = sp.enzyme;
      if (ez === null) continue;
      if (ez.decayVersion !== FS.hideVersion) {
        for (let j = 0; j < ez.n; j++) ez.decay[j] = probFromRate(ez.lam[j] * (1 - hide[ez.subs[j]]));
        ez.decayVersion = FS.hideVersion;
      }
      const s = pos[i];
      let st = state[i];
      const m = ez.sub;
      const inv = 1 / m;
      for (let k = 0; k < m; k++) {
        let rem = 1; // unused share of this substep
        while (rem > 0) {
          if (st === ez.n) {
            // Fully loaded complex: turnover or loss of the last substrate.
            const kc = ez.kcatDt * inv, ko = ez.koffDt[st - 1] * inv;
            const r = rng.next();
            const x = (kc + ko) * rem;
            if (r >= probFromRate(x)) break;
            rem -= negLog(1 - r) / (kc + ko);
            if (rng.next() * (kc + ko) < kc) {
              for (let j = 0; j < ez.prods.length; j++) FS.release(ez.prods[j], s, q);
              st = 0;
              events[sp.index] += 1;
            } else {
              FS.release(ez.subs[st - 1], s, q);
              st--;
            }
            continue;
          }
          // Free binding site: it soaks up substrate from its lattice site
          // (a linear sink, as for a real absorber, so the field never goes
          // negative) and binds once a random amount, exponential with a
          // mean of one molecule, has been gathered. Each binding costs
          // exactly one molecule, so mass is conserved. The part of the
          // dent that diffusion would already have refilled is hidden, so
          // visible substrate decays at lam (1 - h).
          let tOff = Infinity;
          if (st > 0) {
            const ko = ez.koffDt[st - 1] * inv;
            const r = rng.next();
            if (r < probFromRate(ko * rem)) tOff = negLog(1 - r) / ko;
          }
          const fk = ez.subs[st];
          const c = F[fk][s] - fresh[fk][s];
          const slot = i * SUB_SLOTS + st;
          let tBind = Infinity;
          let nd = need[slot];
          if (c > 0) {
            if (nd <= 0) { nd = q * negLog(1 - rng.next()); need[slot] = nd; }
            const keep = 1 - hide[fk];
            const want = (nd - credit[slot]) * keep / c; // share of visible c
            if (want <= 0) tBind = 0;
            else if (want < 1) {
              const lam = ez.lam[st] * keep;
              const t = negLog(1 - want) / lam;
              if (t < rem) tBind = t;
            }
          }
          const t = Math.min(tOff, tBind, rem);
          if (c > 0) {
            // Gather until t.
            const keep = 1 - hide[fk];
            let d;
            if (t === tBind) d = Math.max(0, nd - credit[slot]);
            else if (t === 1) d = c * ez.decay[st] / keep;
            else d = c * probFromRate(ez.lam[st] * keep * t) / keep;
            F[fk][s] -= d;
            FS.hideTake(fk, s, d);
            credit[slot] += d;
          }
          rem -= t;
          if (t === tBind) {
            credit[slot] -= q;
            need[slot] = 0;
            st++;
          } else if (t === tOff) {
            FS.release(ez.subs[st - 1], s, q);
            st--;
          } else break;
        }
      }
      state[i] = st;
    }
  }



  step() {
    this.diffuseParticles();
    this.enzymeKinetics();
    for (let k = 0; k < this.systems.length; k++) this.systems[k](this);
    this.stepCount++;
    this.time = this.stepCount * this.dt;
    if (this.stepCount % this.fieldEvery === 0) {
      this.fields.diffuse(this.fieldEvery * this.dt);
      this.onFieldUpdate?.(this);
    }
  }

  // Bumped whenever site types change, so renderers can re-upload them.
  touchSites() { this.siteVersion++; this.fields.dirty = true; }

  // A fingerprint of the full state, used to prove seeded runs reproduce.
  fingerprint() {
    let h = hashNumbers(0, [this.stepCount, ...this.rng.getState()]);
    const live = [];
    for (let i = 0; i < this.cap; i++) {
      if (this.alive[i]) {
        live.push(i, this.pos[i], this.kind[i], this.state[i]);
        for (let j = i * SUB_SLOTS; j < (i + 1) * SUB_SLOTS; j++) live.push(this.credit[j], this.need[j]);
      }
    }
    h = hashNumbers(h, live);
    for (const f of this.fields.data) h = hashNumbers(h, f);
    return h.toString(16).padStart(8, '0');
  }
}
