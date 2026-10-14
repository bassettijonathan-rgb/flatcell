// Builds the RGBA background texture: site types, optionally tinted by a
// metabolite heatmap.

const OUT = 0, MEMBRANE = 1;

// Sequential ramp for concentrations (low = the cytoplasm colour).
const RAMP = [
  [0.00, [0.20, 0.36, 0.52]],
  [0.45, [0.17, 0.56, 0.52]],
  [0.80, [0.55, 0.78, 0.36]],
  [1.00, [0.98, 0.88, 0.30]],
];

function ramp(t, out) {
  for (let k = 1; k < RAMP.length; k++) {
    if (t <= RAMP[k][0]) {
      const [t0, a] = RAMP[k - 1], [t1, b] = RAMP[k];
      const u = (t - t0) / (t1 - t0);
      out[0] = a[0] + (b[0] - a[0]) * u;
      out[1] = a[1] + (b[1] - a[1]) * u;
      out[2] = a[2] + (b[2] - a[2]) * u;
      return out;
    }
  }
  out[0] = 0.99; out[1] = 0.91; out[2] = 0.15;
  return out;
}

export function rampCss(t) {
  const c = ramp(t, [0, 0, 0]);
  return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
}

export function buildBackground(rgba, sites, W, H, heat, heatMax, theme) {
  const n = W * H;
  if (!rgba || rgba.length !== n * 4) rgba = new Uint8Array(n * 4);
  const cy = theme.cyto, mem = theme.membrane;
  const tmp = [0, 0, 0];
  const inv = heat && heatMax > 0 ? 1 / heatMax : 0;
  for (let s = 0; s < n; s++) {
    const o = s * 4;
    const t = sites[s];
    if (t === OUT) { rgba[o] = rgba[o + 1] = rgba[o + 2] = rgba[o + 3] = 0; continue; }
    let r, g, b;
    if (t === MEMBRANE) { r = mem[0]; g = mem[1]; b = mem[2]; }
    else { r = cy[0]; g = cy[1]; b = cy[2]; }
    if (heat) {
      let v = heat[s] * inv;
      if (v < 0) v = 0;
      if (v > 1) v = 1;
      ramp(v, tmp);
      // Low concentrations fade into the cytoplasm colour.
      const a = Math.min(1, 0.15 + v * 1.1) * theme.heatStrength;
      r = r + (tmp[0] - r) * a;
      g = g + (tmp[1] - g) * a;
      b = b + (tmp[2] - b) * a;
    }
    rgba[o] = r * 255;
    rgba[o + 1] = g * 255;
    rgba[o + 2] = b * 255;
    rgba[o + 3] = 255;
  }
  return rgba;
}
