// Milestone 1 adapter: what the app shows and lets you change in the test tube.

import { createTestTube, ENZYME_CHOICES, defaultKon, TESTTUBE_DEFAULTS } from './testtube.js';
import { REACTIONS, GENES } from '../data/syn3a.js';
import { D_METABOLITE } from '../core/units.js';

const GENE_OF = { TPI: 'tpiA', PGI: 'pgi', PGM: 'pgm', ENO: 'eno' };

export const M1 = {
  id: 'm1',
  title: 'Test tube',
  blurb: 'One syn3A enzyme and its substrate. Every product molecule comes from an enzyme bumping into substrate in its own 10 nm site.',
  defaults: TESTTUBE_DEFAULTS,

  create(options, carry = {}) {
    const sc = createTestTube(options);
    const w = sc.world;
    const opts = sc.opts;
    const r = REACTIONS[opts.enzyme];
    const gene = GENES.find((g) => g.id === GENE_OF[opts.enzyme]);
    carry.sweeps = carry.sweeps || [];
    sc.sweeps = carry.sweeps;

    const a = {
      sc,
      world: w,
      opts,
      viewBox: [4, 4, w.W - 4, w.H - 4],
      timeUnit: 'tube',
      boost: 1,

      info() {
        const Km = opts.perfect ? sc.theory().Km : r.Km[0];
        const perfect = !!opts.perfect;
        return {
          id: 'm1',
          title: M1.title,
          blurb: M1.blurb,
          species: w.species.map((sp) => ({ name: sp.name, label: sp.label, color: sp.color, radius: sp.radius, gene: sp.gene })),
          fields: w.fields.defs.map((d) => ({ index: d.index, name: d.name, label: d.label })),
          layers: [
            { id: 'sp:enzyme', label: gene.name, kind: 'species', on: true },
            { id: 'sp:crowder', label: 'Crowders', kind: 'species', on: true },
            { id: 'heat:S', label: r.subs[0].toUpperCase() + ' heatmap', kind: 'heat', field: sc.fields.S, on: true },
            { id: 'heat:P', label: r.prods[0].toUpperCase() + ' heatmap', kind: 'heat', field: sc.fields.P, on: false },
          ],
          controls: [
            { id: 'enzyme', label: 'Enzyme', type: 'select', value: opts.enzyme, rebuild: true,
              options: ENZYME_CHOICES.map((e) => ({ value: e, label: `${GENES.find((g) => g.id === GENE_OF[e]).name} (${REACTIONS[e].subs[0].toUpperCase()} → ${REACTIONS[e].prods[0].toUpperCase()})` })) },
            { id: 'mode', label: 'Kinetics', type: 'select', value: perfect ? 'perfect' : 'measured', rebuild: true,
              options: [
                { value: 'measured', label: 'Measured syn3A kcat and Km' },
                { value: 'perfect', label: 'Diffusion-limited enzyme' },
              ] },
            { id: 'S', label: 'Substrate', type: 'log', min: Km * 0.05, max: Km * 10, value: sc.S, unit: 'mM',
              hint: perfect ? `Km ≈ ${fmt(Km)} mM, set by how fast substrate arrives` : `Km = ${fmt(Km)} mM` },
            { id: 'crowding', label: 'Crowding', type: 'range', min: 0, max: 0.5, step: 0.05, value: opts.crowding, unit: '%', scale: 100, rebuild: true, hint: 'share of sites filled by inert proteins; syn3A cytoplasm is about 30%' },
            { id: 'substrateD', label: 'Substrate diffusion', type: 'log', min: 0.2, max: D_METABOLITE, value: opts.substrateD, unit: 'µm²/s', hint: '200 = small metabolite, 1 = protein-sized' },
            ...(perfect ? [] : [{ id: 'kon', label: 'Association rate', type: 'log', min: 1e6, max: 1e9, value: opts.kon || defaultKon(opts.enzyme), unit: '/M/s', rebuild: true, hint: 'how fast substrate binds once it meets the enzyme' }]),
            { id: 'enzymes', label: 'Enzyme molecules', type: 'range', min: 4, max: 120, step: 1, value: sc.enzymes.length, unit: '', rebuild: true, hint: `syn3A level is ${sc.setup.nativeCount} here (${fmt(sc.setup.nativeUM)} µM)` },
          ],
          actions: [
            { id: 'sweep', label: 'Run sweep' },
            { id: 'clear', label: 'Clear curves' },
          ],
          charts: ['mm', 'rate'],
          gene: geneCard(gene, opts.enzyme, sc),
          clock: { dt: w.dt, boost: 1, unit: 'tube time' },
        };
      },

      step() { sc.step(); },

      control(id, value) {
        if (id === 'S') { sc.setS(value); return null; }
        if (id === 'substrateD') {
          w.fields.setD(sc.fields.S, value);
          opts.substrateD = value;
          return null;
        }
        if (id === 'mode') {
          // Curves from the other mode sit on a different scale.
          carry.sweeps.length = 0;
          const perfect = value === 'perfect';
          return { ...opts, perfect, substrateD: perfect ? 1 : D_METABOLITE, kon: null, S: null };
        }
        if (id === 'crowding' || id === 'enzymes' || id === 'kon' || id === 'enzyme') {
          const next = { ...opts, [id]: value };
          if (id === 'enzyme') { next.kon = null; next.S = null; next.enzymes = 0; carry.sweeps.length = 0; }
          else next.S = sc.S;
          return next;
        }
        return null;
      },

      action(id) {
        if (id === 'sweep') { sc.startSweep(); return null; }
        if (id === 'clear') { carry.sweeps.length = 0; return null; }
        return null;
      },

      busy(i) { return w.state[i] > 0; },

      stats() {
        const th = sc.theory();
        const sw = sc.sweep;
        return {
          S: sc.S,
          rate: sc.live.rate,
          rateErr: sc.live.err,
          theory: th,
          Deff: sc.msd.D,
          Dfree: sc.setup.D,
          bound: 1 - sc.countFree() / sc.enzymes.length,
          sweep: sw ? { k: sw.k, n: sw.points.length, results: sw.results, label: sc.describe() } : null,
          sweeps: carry.sweeps.map((s) => ({ label: s.label, results: s.results })),
          events: w.events[sc.species.enzyme],
          label: sc.describe(),
        };
      },
    };
    return a;
  },
};

function fmt(x) {
  if (x >= 100) return x.toFixed(0);
  if (x >= 10) return x.toFixed(1);
  if (x >= 1) return x.toFixed(2);
  return x.toPrecision(2);
}

function geneCard(gene, rxnName, sc) {
  const r = REACTIONS[rxnName];
  return {
    id: gene.id,
    name: gene.name,
    loci: gene.loci,
    product: gene.product,
    role: gene.role,
    rows: [
      ['Locus', gene.loci.join(', ')],
      ['Reaction', `${r.subs.join(' + ').toUpperCase()} → ${r.prods.join(' + ').toUpperCase()}`],
      ['Copies per syn3A cell', gene.copies.toLocaleString('en-US')],
      ['mRNAs per cell', String(gene.mrna)],
      ['kcat', `${r.kcat} /s`],
      ['Km (measured)', `${r.Km[0]} mM`],
      ['Particle mass', `${sc.setup.kDa} kDa`],
      ['Diffusion', `${sc.setup.D.toFixed(1)} µm²/s`],
      ['Per-site binding rate', `${sc.setup.cal.kSite.toExponential(2)} /M/s`],
      ['Unbinding rate', `${sc.setup.cal.koff.toFixed(0)} /s`],
      ...(sc.opts.perfect ? [['Mode', 'diffusion-limited: binds on 4 of 5 encounters, never lets go']] : []),
    ],
  };
}
