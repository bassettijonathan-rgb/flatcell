// Milestone 4 adapter: the whole cell through its cycle.

import { createWholeCell, CELL_DEFAULTS } from './wholecell.js';
import { describeExpression, geneCard } from './m3.js';
import { CELL } from '../data/syn3a.js';

const MACHINE_LAYERS = [
  ['sp:dna', 'Chromosomes'],
  ['sp:rnap', 'RNA polymerase'],
  ['sp:mrna', 'mRNA'],
  ['sp:ribosome', 'Ribosomes'],
  ['sp:degradosome', 'Degradosomes'],
  ['sp:p:dnaA', 'DnaA'],
  ['sp:p:replisome', 'Replisomes'],
  ['sp:p:ftsZ', 'FtsZ'],
  ['sp:p:fak', 'FakAB'],
  ['sp:p:pls', 'PlsYC (membrane)'],
];

export const M4 = {
  id: 'm4',
  title: 'Whole cell',
  blurb: 'A syn3A cell through a full cycle. Lipid made on encounter grows the membrane and stretches the cell; DnaA opens the origin and two replisomes copy the chromosome; once the DNA is copied and pulled apart and the area has doubled, FtsZ gathers into a ring at midcell and pinches the cell in two. The view then follows one daughter.',
  defaults: CELL_DEFAULTS,

  create(options) {
    const sc = createWholeCell(options);
    const w = sc.world, ex = sc.ex, opts = sc.opts;
    const rows = ex.rows;
    const genes = {};
    rows.forEach((g, k) => { genes[g.id] = geneCard(g, k, sc); });
    let sent = 0;
    const named = rows.filter((g, k) => {
      const sp = w.species[ex.product[k]];
      return g.id !== 'other' && !MACHINE_LAYERS.some(([id]) => id === 'sp:' + sp.name);
    }).map((g) => 'p:' + g.id);

    const a = {
      sc,
      world: w,
      opts,
      viewBox: [6, 3, w.W - 6, w.H - 3],

      info() {
        return {
          id: 'm4',
          title: M4.title,
          blurb: M4.blurb,
          species: w.species.map((sp) => ({ name: sp.name, label: sp.label, color: sp.color, radius: sp.radius, gene: sp.gene })),
          fields: w.fields.defs.map((d) => ({ index: d.index, name: d.name, label: d.label })),
          layers: [
            ...MACHINE_LAYERS.map(([id, label]) => ({ id, label, kind: 'species', on: true })),
            { id: 'grp:named', label: 'Other named proteins', kind: 'species', species: named, swatch: 'p:gapDH', on: false },
            { id: 'sp:other', label: 'Rest of the proteome', kind: 'species', on: false },
            { id: 'heat:fa', label: 'Fatty acid heatmap', kind: 'heat', field: sc.F.fa, on: false },
            { id: 'heat:ap', label: 'Acyl phosphate heatmap', kind: 'heat', field: sc.F.ap, on: false },
          ],
          controls: [
            { id: 'fattyAcid', label: 'Fatty acid supply', type: 'log', min: 0.25, max: 4, value: opts.fattyAcid, unit: '×', hint: 'sets how fast lipid, and so the membrane, is made; division waits for both area and DNA' },
          ],
          actions: [],
          gene: genes.ftsZ,
          genes,
          clock: { dt: w.dt, boost: sc.boost, unit: 'cell time' },
        };
      },

      step() { sc.step(); },

      control(id, value) {
        if (id === 'fattyAcid') { opts.fattyAcid = value; return null; }
        return null;
      },

      action() { return null; },

      busy(i) { return w.state[i] > 0 && w.kind[i] !== sc.spDNA; },

      describe(i) {
        const kd = w.kind[i];
        if (kd === sc.spDNA) {
          const j = sc.rep.chrom.indexOf(i);
          const kbp = (g) => Math.round(((g + 0.5) * CELL.genomeBp) / 54 / 1000);
          if (j >= 0) return `chromosome, around ${kbp(j)} kbp${j === 0 ? ' (origin)' : ''}${sc.rep.copy[j] >= 0 ? ', copied' : ''}`;
          return `new copy, around ${kbp(w.aux[i])} kbp`;
        }
        if (kd === sc.SP.rep) {
          const f = sc.rep.forks.find((x) => x.i === i && !x.done);
          return f ? `replication fork, copying ${Math.round(((f.j + 0.5) * CELL.genomeBp) / 54 / 1000)} kbp` : 'replisome, free';
        }
        if (kd === sc.SP.ftsZ) return w.state[i] > 0 ? 'in the Z ring' : 'free';
        if (kd === sc.SP.dnaA) return sc.rep.started ? 'free (origin already opened)' : 'looking for the origin';
        if (kd === sc.SP.pls || kd === sc.SP.fak) return w.state[i] > 0 ? 'holding substrate' : 'free';
        return describeExpression(w, ex, i, sc.spDNA);
      },

      stats() {
        const cell = sc.cell, rep = sc.rep;
        const B = sc.boost;
        const now = w.time * B;
        let mrna = 0;
        for (const v of ex.mrnaNow) mrna += v;
        const fresh = Math.min(sc.history.length, sc.sampled - sent);
        const newRows = sc.history.slice(sc.history.length - fresh);
        sent = sc.sampled;
        return {
          cycle: cell.cycle,
          phase: sc.phase(),
          age: now - cell.born,
          area: cell.area / sc.A0,
          copied: sc.copied(),
          forks: rep.forks.map((f) => ({ j: f.j, done: f.done })),
          initAt: rep.initAt >= 0 ? rep.initAt - cell.born : -1,
          doneAt: rep.doneAt >= 0 ? rep.doneAt - cell.born : -1,
          ring: sc.ring.members.length,
          neck: Number.isFinite(sc.shape.neck) ? sc.shape.neck / sc.shape.r : 1,
          proteins: sc.proteins(),
          ribosomes: sc.countOf(ex.sp.ribosome),
          rnap: sc.countOf(ex.sp.rnap),
          mrna,
          divisions: cell.divisions.map((d) => ({
            cycle: d.cycle,
            t: d.t,
            cycleTime: d.cycleTime,
            ribosome: d.partition.ribosome || [0, 0],
            rnap: d.partition.rnap || [0, 0],
            mrna: d.partition.mrna || [0, 0],
            dna: d.partition.dna || [0, 0],
          })),
          newRows,
        };
      },
    };
    return a;
  },
};
