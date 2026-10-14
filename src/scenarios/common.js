// Helpers shared by the scenarios: geometry, placement and frame packing.

import { OUTSIDE, MEMBRANE, CYTO } from '../core/world.js';
import { SLOTS_PER_SITE } from '../core/units.js';

// Mark a rounded rectangle [x0,x1) x [y0,y1) as cytoplasm (no membrane: a
// glass test tube has reflecting walls). Returns the number of sites.
export function paintRoundedRect(world, x0, y0, x1, y1, radius, type = CYTO, region = 0) {
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cx = Math.min(Math.max(x + 0.5, x0 + radius), x1 - radius);
      const cy = Math.min(Math.max(y + 0.5, y0 + radius), y1 - radius);
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const s = y * world.W + x;
        world.site[s] = type;
        world.region[s] = region;
        n++;
      }
    }
  }
  world.touchSites();
  return n;
}

// Turn every interior site that touches the outside into membrane.
export function addMembraneRim(world) {
  const { W, N, site } = world;
  const rim = [];
  for (let s = W; s < N - W; s++) {
    if (site[s] !== CYTO) continue;
    if (site[s + 1] === OUTSIDE || site[s - 1] === OUTSIDE || site[s + W] === OUTSIDE || site[s - W] === OUTSIDE) rim.push(s);
  }
  for (const s of rim) site[s] = MEMBRANE;
  world.touchSites();
  return rim.length;
}

export function countSites(world, type) {
  let n = 0;
  for (let s = 0; s < world.N; s++) if (world.site[s] === type) n++;
  return n;
}

const SLOT_DX = [-0.22, 0.22, -0.22, 0.22];
const SLOT_DY = [-0.22, -0.22, 0.22, 0.22];

// Pack particle positions for the renderer: x, y (site units, centre of the
// site at +0.5), species index, flags. Flags: 1 = busy/bound, 2 = followed,
// 4 = highlighted species.
export function packParticles(world, out, opts = {}) {
  const { alive, pos, kind, state, slots, species } = world;
  const W = world.W;
  const hidden = opts.hidden;          // Uint8Array per species, 1 = hide
  const followIndex = opts.followIndex ?? -1;
  const busy = opts.busy;              // optional (i) => boolean
  let n = 0;
  const need = world.count * 4;
  if (!out || out.length < need) out = new Float32Array(Math.max(need, 1024) * 2);
  for (let i = 0; i < world.cap; i++) {
    if (!alive[i]) continue;
    const k = kind[i];
    if (hidden && hidden[k]) continue;
    const s = pos[i];
    const x = s % W, y = (s - x) / W;
    let dx = 0, dy = 0;
    if (species[k].size < SLOTS_PER_SITE) {
      const base = s * SLOTS_PER_SITE;
      for (let q = 0; q < SLOTS_PER_SITE; q++) {
        if (slots[base + q] === i) { dx = SLOT_DX[q]; dy = SLOT_DY[q]; break; }
      }
    }
    let flags = 0;
    if (busy ? busy(i) : state[i] > 0) flags |= 1;
    if (i === followIndex) flags |= 2;
    out[n++] = x + 0.5 + dx;
    out[n++] = y + 0.5 + dy;
    out[n++] = k;
    out[n++] = flags;
  }
  return { buf: out, length: n };
}

// Index of the live particle nearest to (x, y) in site units, or -1.
export function nearestParticle(world, x, y, maxDist = 3) {
  let best = -1, bd = maxDist * maxDist;
  for (let i = 0; i < world.cap; i++) {
    if (!world.alive[i]) continue;
    const s = world.pos[i];
    const px = (s % world.W) + 0.5, py = Math.floor(s / world.W) + 0.5;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function indexOfUid(world, uid) {
  for (let i = 0; i < world.cap; i++) if (world.alive[i] && world.uid[i] === uid) return i;
  return -1;
}

// Concentration (uM) of n molecules spread over `sites` lattice sites.
export function microMolar(n, sites, mmPerMolecule) {
  return (n / sites) * mmPerMolecule * 1000;
}

// syn3A cytoplasm volume (L) for converting copy numbers to concentrations.
export const SYN3A_LITERS = (4 / 3) * Math.PI * 200 ** 3 * 1e-24;
