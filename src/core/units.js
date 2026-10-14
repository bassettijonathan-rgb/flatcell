// Physical constants, unit conversions and the 2D encounter-rate calibration.
//
// The lattice is a slab of 10 nm x 10 nm x 10 nm sites: the "flat cell" is
// one site thick. Concentrations are stored in mM; one molecule in one site
// is 1.66 mM.

export const NA = 6.02214076e23;
export const SITE_NM = 10;        // lattice spacing a
export const SLAB_NM = 10;        // slab thickness h
export const SITE_LITERS = SITE_NM * SITE_NM * SLAB_NM * 1e-24;
export const MM_PER_MOLECULE = fix(1e3 / (NA * SITE_LITERS));
export const SLOTS_PER_SITE = 4;  // a site holds up to four small proteins

// Round a derived parameter to 12 significant digits. Library functions like
// Math.log or Math.cbrt may differ in the last bit between browsers; rounding
// every derived constant keeps seeded runs identical everywhere.
export function fix(x) {
  return Number(x.toPrecision(12));
}

// Probability per step that a particle with diffusion coefficient D (um^2/s)
// hops to one of its 4 neighbours on a 2D lattice: p = 4 D dt / a^2.
export function hopProbability(D, dt) {
  return fix((4 * D * 1e6 * dt) / (SITE_NM * SITE_NM));
}

// Measured cytoplasmic diffusion of GFP (27 kDa) in E. coli is 7.7 um^2/s
// (Elowitz et al. 1999). Other proteins are scaled by Stokes-Einstein,
// D ~ M^(-1/3).
export const D_GFP = 7.7;
export function diffusionFromMass(kDa) {
  return fix(D_GFP * Math.cbrt(27 / kDa));
}

// Small metabolites diffuse about a third as fast in cytoplasm as in water
// (~600-700 um^2/s for glucose-sized molecules in water).
export const D_METABOLITE = 200;

export const EULER_GAMMA = 0.5772156649;

// Steady-state diffusion-limited encounter rate (M^-1 s^-1) of a small
// molecule with diffusion coefficient D (um^2/s) onto a single lattice site
// in 2D, when sinks have catchment radius b (in sites) and the substrate is
// fed uniformly. From the 2D square-lattice Green's function,
// G(0) - G(r) ~ (ln r + gamma + 1.5 ln 2) / 2pi, averaged over the catchment
// annulus (the -3/4 term):
//   kD = 2 pi D h / (ln(b/a) + gamma + 1.5 ln 2 - 3/4)
// In 3D the same quantity is the constant 4 pi D R; in 2D it depends on the
// sink density through ln(b/a), and it vanishes on an infinite plane.
export function encounterRate2D(D, bSites) {
  const Dnm = D * 1e6; // nm^2/s
  const denom = Math.log(Math.max(bSites, 1.5)) + EULER_GAMMA + 1.5 * Math.LN2 - 0.75;
  const nm3PerSecond = (2 * Math.PI * Dnm * SLAB_NM) / denom;
  return fix(nm3PerSecond * 1e-24 * NA);
}

// Catchment radius (sites) for n sinks in an area of `sites` lattice sites.
export function catchmentRadius(sites, n) {
  return fix(Math.sqrt(sites / (Math.PI * Math.max(n, 1))));
}

// Turn measured (3D, well-mixed) Michaelis-Menten constants into per-site
// lattice rates for a single substrate bound in an encounter:
//   E + S <-> ES  (kSite, koff),  ES -> E + P  (kcat)
// With diffusion, the effective association rate is 1/(1/kSite + 1/kD) and a
// released substrate can be recaptured before it escapes, which gives
//   Km_eff = (koff + kcat)/kSite + kcat/kD.
// We pick kSite so the effective association rate equals `kon`, then koff so
// Km_eff equals the measured Km.
export function calibrateBinding({ kcat, KmMilli, kon, D, bSites }) {
  const kD = encounterRate2D(D, bSites);
  const Km = KmMilli * 1e-3;
  let target = Math.min(kon, 0.5 * kD);
  const kSite = 1 / (1 / target - 1 / kD);
  let koff = kSite * (Km - kcat / kD) - kcat;
  let note = '';
  if (kon > 0.5 * kD) note = 'association rate capped at half the 2D diffusion limit';
  if (koff < 0) {
    // Km is below what diffusion allows for this kcat; drop koff to zero.
    koff = 0;
    note = 'Km below the 2D diffusion limit for this kcat';
  }
  return { kSite: fix(kSite), koff: fix(koff), kD, kOnEff: fix(target), note };
}

// Michaelis constant the lattice will produce for given rates and substrate D.
export function predictedKm({ kSite, koff, kcat, D, bSites }) {
  const kD = encounterRate2D(D, bSites);
  return ((koff + kcat) / kSite + kcat / kD) * 1e3; // mM
}
