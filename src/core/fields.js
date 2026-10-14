// Small-molecule concentration fields on the lattice (mM per site).
//
// Fields diffuse on every site that is inside the cell and not filled by a
// particle that excludes small molecules. Diffusion is solved implicitly
// (alternating-direction backward Euler), which is unconditionally stable,
// conserves mass exactly, and lets fields update every few particle steps
// even though metabolites hop ~100x more often than proteins.

import { SITE_NM, fix } from './units.js';

export class FieldSet {
  constructor(world) {
    this.world = world;
    this.defs = [];
    this.data = [];
    this.stash = [];
    this.perm = new Uint8Array(world.N);
    this.gx = new Uint8Array(world.N);
    this.gy = new Uint8Array(world.N);
    this.fresh = [];       // molecules released since the last field update
    this.freshList = [];   // (field, site) pairs to clear
    this.hide = [];        // fraction of a fresh release that has diffused away
    this.factors = new Map();
    this.dirty = true;
    this.box = null;
  }

  add(def) {
    const d = {
      name: def.name,
      label: def.label || def.name,
      D: def.D,                         // um^2/s
      clamp: def.clamp ?? null,         // hold the mean at this value (mM)
      clampRegion: def.clampRegion ?? -1,
      external: def.external ?? 0,      // concentration outside the cell (mM)
      max: def.max || 1,                // colour-scale maximum for heatmaps
      init: def.init ?? 0,
      index: this.defs.length,
    };
    this.defs.push(d);
    const f = new Float64Array(this.world.N);
    const w = this.world;
    for (let s = 0; s < w.N; s++) if (w.site[s] !== 0) f[s] = d.init;
    this.data.push(f);
    this.fresh.push(new Float64Array(this.world.N));
    this.stash.push(0);
    this.updateHide();
    return d.index;
  }

  // Fields only diffuse every few particle steps. A molecule released into a
  // site in between would sit there and be grabbed again at once, which is
  // an artefact: at metabolite speeds it has left the site within a
  // microsecond. Releases (and the holes left by binding) are therefore
  // marked "fresh", and the share that diffusion would already have carried
  // away is invisible to binding until the next field update.
  updateHide() {
    const w = this.world;
    const tau = 0.5 * w.fieldEvery * w.dt;
    this.hide = this.defs.map((d) => {
      const hops = (4 * d.D * 1e6 * tau) / (SITE_NM * SITE_NM);
      return fix(1 - 1 / (1 + hops));
    });
    this.hideVersion = (this.hideVersion || 0) + 1;
  }

  release(k, s, amount) {
    this.data[k][s] += amount;
    const h = this.hide[k];
    if (h > 0) {
      if (this.fresh[k][s] === 0) this.freshList.push(k, s);
      this.fresh[k][s] += amount * h;
    }
  }

  // Binding removes a molecule; the hole it leaves would have been refilled
  // by diffusion just as fast, so it is hidden the same way.
  take(k, s, amount) {
    this.data[k][s] -= amount;
    const h = this.hide[k];
    if (h > 0) {
      if (this.fresh[k][s] === 0) this.freshList.push(k, s);
      this.fresh[k][s] -= amount * h;
    }
  }

  // Substrate captured by an enzyme was already removed from data; hide the
  // part of the dent that diffusion would have refilled by now.
  hideTake(k, s, amount) {
    const h = this.hide[k];
    if (h > 0) {
      if (this.fresh[k][s] === 0) this.freshList.push(k, s);
      this.fresh[k][s] -= amount * h;
    }
  }

  // Concentration at s that a binding attempt can see.
  available(k, s) {
    return this.data[k][s] - this.fresh[k][s];
  }

  clearFresh() {
    const L = this.freshList;
    for (let i = 0; i < L.length; i += 2) this.fresh[L[i]][L[i + 1]] = 0;
    L.length = 0;
  }

  setD(k, D) {
    this.defs[k].D = D;
    this.updateHide();
  }

  byName(name) {
    const d = this.defs.find((x) => x.name === name);
    return d ? d.index : -1;
  }

  // A blocker entered site s: lift its molecules out.
  pushOut(s) {
    for (let k = 0; k < this.data.length; k++) {
      this.stash[k] += this.data[k][s];
      this.data[k][s] = 0;
    }
  }

  // ...and put them in site s (normally the site the blocker just left).
  pullIn(s) {
    for (let k = 0; k < this.data.length; k++) {
      this.data[k][s] += this.stash[k];
      this.stash[k] = 0;
    }
  }

  // Put stashed molecules into the nearest site that accepts them.
  flushNear(s) {
    const w = this.world;
    const W = w.W;
    for (let rad = 1; rad < 8; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const t = s + dy * W + dx;
          if (t < 0 || t >= w.N) continue;
          if (w.site[t] !== 0 && w.block[t] === 0) { this.pullIn(t); return; }
        }
      }
    }
    this.pullIn(s);
  }

  // Recompute which sites small molecules can enter. Only needed when site
  // types change or a blocker enters an empty site / leaves its last one.
  updatePermeability() {
    const w = this.world;
    if (!this.dirty && this.box) return;
    const { perm, gx, gy } = this;
    const W = w.W, H = w.H, N = w.N;
    if (this.boxVersion !== w.siteVersion || !this.box) {
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (w.site[y * W + x] === 0) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      this.box = [x0, x1, y0, y1];
      this.boxVersion = w.siteVersion;
    }
    for (let s = 0; s < N; s++) perm[s] = w.site[s] !== 0 && w.block[s] === 0 ? 1 : 0;
    for (let s = 0; s < N - W; s++) {
      gx[s] = perm[s] & perm[s + 1];
      gy[s] = perm[s] & perm[s + W];
    }
    this.dirty = false;
    this.factors.clear();
  }

  diffuse(Dt) {
    this.clearFresh();
    this.updatePermeability();
    // Group fields by diffusion coefficient so each factorisation is reused.
    const groups = new Map();
    for (const d of this.defs) {
      if (!(d.D > 0)) continue;
      if (!groups.has(d.D)) groups.set(d.D, []);
      groups.get(d.D).push(this.data[d.index]);
    }
    if (this.box[1] < 0) return;
    for (const [D, fields] of groups) {
      const r = fix((D * 1e6 * Dt) / (SITE_NM * SITE_NM));
      let fac = this.factors.get(r);
      if (!fac) {
        fac = { x: this._factor(r, this.gx, 1), y: this._factor(r, this.gy, this.world.W) };
        this.factors.set(r, fac);
      }
      // Alternate the sweep order so the splitting error has no preferred axis.
      if (this.flip) { this._sweepY(fields, fac.y); this._sweepX(fields, fac.x); }
      else { this._sweepX(fields, fac.x); this._sweepY(fields, fac.y); }
    }
    this.flip = !this.flip;
    for (const d of this.defs) if (d.clamp !== null) this.applyClamp(d);
  }

  // LU factors of the tridiagonal operator along x (stride 1) or y (stride W)
  // for one value of r = D dt / a^2.
  _factor(r, g, stride) {
    const W = this.world.W, N = this.world.N;
    const [x0, x1, y0, y1] = this.box;
    const im = new Float64Array(N), al = new Float64Array(N), cp = new Float64Array(N);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const s = y * W + x;
        const atStart = stride === 1 ? x === x0 : y === y0;
        const atEnd = stride === 1 ? x === x1 : y === y1;
        const gl = atStart ? 0 : g[s - stride];
        const gr = atEnd ? 0 : g[s];
        const a = -r * gl;
        const prevC = atStart ? 0 : cp[s - stride];
        const inv = 1 / (1 + r * (gl + gr) - a * prevC);
        im[s] = inv;
        al[s] = a;
        cp[s] = -r * gr * inv;
      }
    }
    return { im, al, cp };
  }

  // Implicit sweeps. Each solves, along one direction,
  //   (1 + r(gL + gR)) c_i - r gL c_{i-1} - r gR c_{i+1} = c_i_old
  // with the Thomas algorithm; bonds with g = 0 split a line into
  // independent segments. Along x, four rows are solved side by side and
  // along y all columns of a row advance together, so the CPU can overlap
  // the otherwise serial recurrences.
  _sweepX(fields, fac) {
    const W = this.world.W;
    const [x0, x1, y0, y1] = this.box;
    const { im, al, cp } = fac;
    const len = x1 - x0 + 1;
    for (let q = 0; q < fields.length; q++) {
      const f = fields[q];
      let y = y0;
      for (; y + 3 <= y1; y += 4) {
        const b0 = y * W + x0, b1 = b0 + W, b2 = b1 + W, b3 = b2 + W;
        let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
        for (let k = 0; k < len; k++) {
          const s0 = b0 + k, s1 = b1 + k, s2 = b2 + k, s3 = b3 + k;
          p0 = f[s0] = (f[s0] - al[s0] * p0) * im[s0];
          p1 = f[s1] = (f[s1] - al[s1] * p1) * im[s1];
          p2 = f[s2] = (f[s2] - al[s2] * p2) * im[s2];
          p3 = f[s3] = (f[s3] - al[s3] * p3) * im[s3];
        }
        for (let k = len - 2; k >= 0; k--) {
          const s0 = b0 + k, s1 = b1 + k, s2 = b2 + k, s3 = b3 + k;
          f[s0] -= cp[s0] * f[s0 + 1];
          f[s1] -= cp[s1] * f[s1 + 1];
          f[s2] -= cp[s2] * f[s2 + 1];
          f[s3] -= cp[s3] * f[s3 + 1];
        }
      }
      for (; y <= y1; y++) {
        const b0 = y * W + x0;
        let p0 = 0;
        for (let k = 0; k < len; k++) {
          const s0 = b0 + k;
          p0 = f[s0] = (f[s0] - al[s0] * p0) * im[s0];
        }
        for (let k = len - 2; k >= 0; k--) {
          const s0 = b0 + k;
          f[s0] -= cp[s0] * f[s0 + 1];
        }
      }
    }
  }

  _sweepY(fields, fac) {
    const W = this.world.W;
    const [x0, x1, y0, y1] = this.box;
    const { im, al, cp } = fac;
    for (let q = 0; q < fields.length; q++) {
      const f = fields[q];
      for (let x = x0; x <= x1; x++) {
        const s = y0 * W + x;
        f[s] = f[s] * im[s];
      }
      for (let y = y0 + 1; y <= y1; y++) {
        const b = y * W;
        for (let x = x0; x <= x1; x++) {
          const s = b + x;
          f[s] = (f[s] - al[s] * f[s - W]) * im[s];
        }
      }
      for (let y = y1 - 1; y >= y0; y--) {
        const b = y * W;
        for (let x = x0; x <= x1; x++) {
          const s = b + x;
          f[s] -= cp[s] * f[s + W];
        }
      }
    }
  }

  // Chemostat: shift the mean over open sites (optionally one region) back
  // to the clamp value by adding or removing molecules uniformly.
  applyClamp(d) {
    const w = this.world;
    const f = this.data[d.index];
    const perm = this.perm;
    let sum = 0, n = 0;
    for (let s = 0; s < w.N; s++) {
      if (!perm[s]) continue;
      if (d.clampRegion >= 0 && w.region[s] !== d.clampRegion) continue;
      sum += f[s];
      n++;
    }
    if (n === 0) return;
    const add = (d.clamp * n - sum) / n;
    for (let s = 0; s < w.N; s++) {
      if (!perm[s]) continue;
      if (d.clampRegion >= 0 && w.region[s] !== d.clampRegion) continue;
      f[s] += add;
    }
  }

  // Mean concentration over open sites, optionally restricted to a region.
  mean(index, region = -1) {
    const w = this.world;
    const f = this.data[index];
    let sum = 0, n = 0;
    for (let s = 0; s < w.N; s++) {
      if (w.site[s] === 0 || w.block[s] !== 0) continue;
      if (region >= 0 && w.region[s] !== region) continue;
      sum += f[s];
      n++;
    }
    return n ? sum / n : 0;
  }

  total(index) {
    const f = this.data[index];
    let sum = 0;
    for (let s = 0; s < f.length; s++) sum += f[s];
    return sum;
  }
}
