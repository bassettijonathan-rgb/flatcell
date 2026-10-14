// Seeded pseudo-random numbers. sfc32 uses only 32-bit integer ops, so a
// given seed gives the same stream in every JavaScript engine.

export function makeRng(seed) {
  // splitmix32 expands one integer seed into four state words.
  let s = seed >>> 0;
  const split = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  // State lives in an Int32Array so values never leave the small-integer
  // range V8 keeps unboxed; this makes a draw ~10x cheaper.
  const st = new Int32Array([split(), split(), split(), split()]);
  const u32 = () => {
    const a = st[0], b = st[1], c = st[2], d = st[3];
    const t = (((a + b) | 0) + d) | 0;
    st[3] = (d + 1) | 0;
    st[0] = b ^ (b >>> 9);
    st[1] = (c + (c << 3)) | 0;
    const c2 = (c << 21) | (c >>> 11);
    st[2] = (c2 + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) u32();
  return {
    u32,
    // Uniform in [0, 1).
    next: () => u32() * 2.3283064365386963e-10,
    // Integer in [0, n).
    int: (n) => Math.floor(u32() * 2.3283064365386963e-10 * n),
    getState: () => [st[0] >>> 0, st[1] >>> 0, st[2] >>> 0, st[3] >>> 0],
    setState: (v) => { st[0] = v[0]; st[1] = v[1]; st[2] = v[2]; st[3] = v[3]; },
  };
}

// 1 - exp(-x) using only + - * /, so probabilities are bit-identical across
// engines (Math.exp is not required to be correctly rounded).
export function probFromRate(x) {
  if (!(x > 0)) return 0;
  if (x > 40) return 1;
  // exp(-x) = (exp(-x / 2^k))^(2^k), with a Taylor series for the small part.
  let k = 0;
  let y = x;
  while (y > 0.0625) { y *= 0.5; k++; }
  // exp(-y) for y <= 1/16, 8 terms is far below double precision error.
  let term = 1, sum = 1;
  for (let n = 1; n <= 8; n++) { term *= -y / n; sum += term; }
  for (let i = 0; i < k; i++) sum *= sum;
  return 1 - sum;
}

// -ln(u) for u in (0, 1], again from + - * / only: an exponential(1) draw.
export function negLog(u) {
  if (!(u > 0)) return 40;
  let e = 0;
  while (u < 0.5) { u *= 2; e++; }
  // ln(u) = 2 atanh(z), z = (u - 1) / (u + 1), |z| <= 1/3.
  const z = (u - 1) / (u + 1), z2 = z * z;
  let term = z, sum = z;
  for (let n = 3; n <= 27; n += 2) { term *= z2; sum += term / n; }
  return e * 0.6931471805599453 - 2 * sum;
}

// FNV-1a over numbers, for state fingerprints in determinism checks.
export function hashNumbers(h, arr) {
  h = h >>> 0 || 2166136261;
  const f = new Float64Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < arr.length; i++) {
    f[0] = arr[i];
    h = Math.imul(h ^ u[0], 16777619) >>> 0;
    h = Math.imul(h ^ u[1], 16777619) >>> 0;
  }
  return h >>> 0;
}
