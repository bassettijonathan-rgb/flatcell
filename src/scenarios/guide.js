// Helpers for the page's explanations: labels on the view, a feed of
// notable moments, and number formatting for sentences.

export function labelAt(world, i, text) {
  if (i < 0 || !world.alive[i]) return null;
  const s = world.pos[i];
  return { x: (s % world.W) + 0.5, y: Math.floor(s / world.W) + 0.5, text };
}

// Centre of a set of particles, for labelling a group.
export function labelCentre(world, list, text) {
  let x = 0, y = 0, n = 0;
  for (const i of list) {
    if (i < 0 || !world.alive[i]) continue;
    const s = world.pos[i];
    x += (s % world.W) + 0.5; y += Math.floor(s / world.W) + 0.5; n++;
  }
  return n ? { x: x / n, y: y / n, text } : null;
}

export function firstOf(world, spIndex, test) {
  for (let i = 0; i < world.cap; i++) if (world.alive[i] && world.kind[i] === spIndex && (!test || test(i))) return i;
  return -1;
}

// Moments to report, collected as they happen and handed over once.
export function feed() {
  const q = [];
  return {
    push(t, text) { q.push({ t, text }); if (q.length > 50) q.shift(); },
    take() { return q.splice(0); },
  };
}

export function num(x) {
  const a = Math.abs(x);
  if (a >= 100) return Math.round(x).toLocaleString('en-US');
  if (a >= 10) return x.toFixed(0);
  if (a >= 1) return x.toFixed(1);
  if (a === 0) return '0';
  return x.toPrecision(2);
}

export const HOW_TO_READ = 'Each dot is one protein or complex, moving by random diffusion on a grid of 10 nm squares. A dot with a bright centre is busy: holding a substrate, copying a gene, or translating. Small molecules are far too many to draw, so they are shown as heatmaps.';
