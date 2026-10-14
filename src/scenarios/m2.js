// Milestone 2 adapter: the glycolysis box and the channelling pair.

import { createGlycolysis, GLYCO_DEFAULTS, FIELDS } from './glycolysis.js';
import { REACTIONS, GENES, METABOLITES } from '../data/syn3a.js';
import { D_METABOLITE } from '../core/units.js';

const HEAT_FIELDS = ['atp', 'adp', 'fdp', 'g3p', 'bpg', 'pep', 'nadh', 'lac'];

export const M2 = {
  id: 'm2',
  title: 'Glycolysis box',
  blurb: 'A patch of syn3A cytoplasm with every glycolytic enzyme at its measured copy number. Glucose comes in through the membrane, ATP is spent by the rest of the cell, and the pathway’s flux, bottleneck and ATP output emerge from encounters.',
  defaults: GLYCO_DEFAULTS,

  create(options, carry = {}) {
    const sc = createGlycolysis(options);
    const w = sc.world;
    const opts = sc.opts;
    carry.runs = carry.runs || [];
    const t0 = sc.totals();
    // Each channelling run keeps its own entry, so earlier conditions stay
    // on the chart for comparison.
    const runIndex = sc.pair ? carry.runs.push(null) - 1 : -1;

    const genes = {};
    for (const rxn of sc.steps) {
      const g = GENES.find((x) => x.rxn === rxn);
      genes[g.id] = geneCard(g, rxn, sc);
    }

    const a = {
      sc,
      world: w,
      opts,
      viewBox: [4, 4, w.W - 4, w.H - 4],

      info() {
        const pair = sc.pair;
        const layers = [
          ...sc.steps.map((rxn) => ({ id: 'sp:' + rxn, label: w.species[sc.species[rxn]].label, kind: 'species', on: true })),
          ...(opts.crowders ? [
            { id: 'sp:crowder', label: 'Other proteins', kind: 'species', on: !pair },
            { id: 'sp:ribosome', label: 'Ribosomes', kind: 'species', on: true },
          ] : []),
          ...(pair ? ['bpg', 'g3p'] : HEAT_FIELDS).map((n, k) => ({ id: 'heat:' + n, label: heatLabel(n), kind: 'heat', field: sc.F[n], on: k === 0 })),
        ];
        const controls = [
          { id: 'mode', label: 'Scene', type: 'select', value: opts.mode, rebuild: true,
            options: [{ value: 'pathway', label: 'Whole pathway, glucose to lactate' }, { value: 'pair', label: 'Channelling: GapDH → 1,3-BPG → Pgk' }] },
        ];
        if (pair) {
          controls.push(
            { id: 'arrangement', label: 'Enzymes', type: 'select', value: opts.arrangement, rebuild: true,
              options: [{ value: 'spread', label: 'Spread through the box' }, { value: 'clustered', label: 'Clustered in one patch' }] },
            { id: 'leak', label: '1,3-BPG lost to other fates', type: 'log', min: 1e2, max: 1e5, value: opts.leak, unit: '/s', rebuild: true, hint: `range before it is lost: ${fmtNm(leakRange(opts.bpgD, opts.leak))}` },
            { id: 'bpgD', label: '1,3-BPG diffusion', type: 'log', min: 1, max: D_METABOLITE, value: opts.bpgD, unit: 'µm²/s', rebuild: true, hint: '200 = free metabolite; lower = held near the enzymes' },
          );
        } else {
          controls.push(
            { id: 'glucose', label: 'Glucose in the medium', type: 'log', min: 0.005, max: 10, value: opts.glucose, unit: 'mM', hint: 'PTS half-saturates at 0.1 mM' },
            { id: 'atpDemand', label: 'ATP demand', type: 'log', min: 0.02, max: 2, value: opts.atpDemand, unit: '/s', hint: 'share of the ATP pool the rest of the cell spends each second' },
            { id: 'crowders', label: 'Rest of the proteome', type: 'select', value: opts.crowders ? 'on' : 'off', rebuild: true,
              options: [{ value: 'on', label: 'Present (syn3A crowding)' }, { value: 'off', label: 'Removed' }] },
          );
        }
        return {
          id: 'm2',
          title: M2.title,
          blurb: pair
            ? 'GapDH makes 1,3-bisphosphoglycerate; Pgk turns it into 3-phosphoglycerate and ATP, unless it is lost first. Does packing the two enzymes together help?'
            : M2.blurb,
          species: w.species.map((sp) => ({ name: sp.name, label: sp.label, color: sp.color, radius: sp.radius, gene: sp.gene })),
          fields: w.fields.defs.map((d) => ({ index: d.index, name: d.name, label: d.label })),
          layers,
          controls,
          actions: pair ? [{ id: 'clear', label: 'Clear results' }] : [],
          gene: genes.gapDH,
          genes,
          clock: { dt: w.dt, boost: 1, unit: 'cell time' },
        };
      },

      step() { sc.step(); },

      control(id, value) {
        if (id === 'mode') { carry.runs.length = 0; return { ...GLYCO_DEFAULTS, seed: opts.seed, mode: value }; }
        if (id === 'arrangement' || id === 'bpgD' || id === 'leak') return { ...opts, [id]: value };
        if (id === 'crowders') return { ...opts, crowders: value === 'on' };
        if (id === 'glucose') { sc.setGlucose(value); return null; }
        if (id === 'atpDemand') { sc.rates.atpDemand = value; opts.atpDemand = value; return null; }
        return null;
      },

      action(id) {
        if (id === 'clear') { carry.runs.length = 0; return { ...opts }; }
        return null;
      },

      busy(i) { return w.state[i] > 0; },

      stats() {
        const fx = sc.flux();
        const toMM = 1 / sc.molPerMM;
        const occ = {};
        for (const rxn of sc.steps) {
          const list = sc.enzymes[rxn];
          let b = 0;
          const full = w.species[sc.species[rxn]].enzyme.n;
          for (const i of list) if (w.state[i] === full) b++;
          occ[rxn] = list.length ? b / list.length : 0;
        }
        const conc = {};
        for (const n of Object.keys(sc.F)) conc[n] = sc.mean(n);
        if (sc.pair) {
          const z = sc.totals();
          const made = z.e.GAPD - t0.e.GAPD, used = z.e.PGK - t0.e.PGK, lost = z.bpgLost - t0.bpgLost;
          const run = { label: `${opts.arrangement}, lost at ${fmtRate(opts.leak)}, D ${fmtD(opts.bpgD)}`, arrangement: opts.arrangement, made, used, lost, yield: made > 0 ? used / made : 0, time: w.time };
          if (runIndex >= 0 && runIndex < carry.runs.length) carry.runs[runIndex] = run;
          return {
            mode: 'pair',
            conc,
            flux: { GAPD: fx.GAPD * toMM, PGK: fx.PGK * toMM, lost: fx.bpgLost * toMM },
            occ,
            run,
            runs: carry.runs.filter(Boolean),
            range: leakRange(opts.bpgD, opts.leak),
            clusterR: sc.clusterR * 10,
          };
        }
        const flux = {};
        for (const rxn of sc.steps) flux[rxn] = fx[rxn] * toMM;
        const atpMade = (fx.PGK + fx.PYK - fx.PFK) * toMM;
        return {
          mode: 'pathway',
          conc,
          ref: Object.fromEntries(FIELDS.map((n) => [n, METABOLITES[n].mM])),
          flux,
          occ,
          window: fx.T,
          atpMade,
          atpUsed: fx.atpUsed * toMM,
          lacOut: fx.lacOut * toMM,
          uptake: flux.GLCpts,
          vmax: Object.fromEntries(sc.steps.map((rxn) => [rxn, (sc.enzymes[rxn].length * w.species[sc.species[rxn]].enzyme.kcatDt / w.dt) / sc.molPerMM])),
        };
      },
    };
    return a;
  },
};

function heatLabel(n) {
  const short = { atp: 'ATP', adp: 'ADP', fdp: 'FBP', g3p: 'G3P', bpg: '1,3-BPG', pep: 'PEP', nadh: 'NADH', lac: 'Lactate' };
  return (short[n] || n) + ' heatmap';
}

// How far (nm) the intermediate typically gets before it is lost.
function leakRange(D, k) { return Math.sqrt((4 * D * 1e6) / k); }
function fmtNm(x) { return x >= 1000 ? `${(x / 1000).toFixed(1)} µm` : `${Math.round(x)} nm`; }
function fmtRate(k) { return k >= 1000 ? `${+(k / 1000).toPrecision(2)}k/s` : `${Math.round(k)}/s`; }
function fmtD(D) { return D >= 10 ? `${Math.round(D)}` : D.toPrecision(2); }

function geneCard(g, rxn, sc) {
  const r = REACTIONS[rxn];
  const subs = r.subs.map((s, j) => `${s.toUpperCase()} ${r.Km[j]} mM`).join(', ');
  return {
    id: g.id,
    name: g.name,
    loci: g.loci,
    product: g.product,
    role: g.role,
    rows: [
      ['Locus', g.loci.join(', ')],
      ['Reaction', `${r.subs.join(' + ').toUpperCase()} → ${r.prods.join(' + ').toUpperCase()}${rxn === 'GLCpts' ? ' (with medium glucose)' : ''}`],
      ['Copies per syn3A cell', g.copies.toLocaleString('en-US')],
      ['In this box', `${sc.enzymes[rxn].length}${g.membrane ? ' (in the membrane)' : ''}`],
      ['mRNAs per cell', String(g.mrna)],
      ['kcat', `${r.kcat} /s`],
      ['Km', subs],
    ],
  };
}
