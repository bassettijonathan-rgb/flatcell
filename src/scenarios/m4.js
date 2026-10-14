// Milestone 4 adapter: the whole cell through its cycle.

import { createWholeCell, CELL_DEFAULTS } from './wholecell.js';
import { describeExpression, geneCard } from './m3.js';
import { CELL } from '../data/syn3a.js';
import { labelAt, labelCentre, firstOf, num, HOW_TO_READ } from './guide.js';

const MACHINE_LAYERS = [
  ['sp:dna', 'Chromosomes', 'The chromosome as 54 beads of about 10 kbp. Once copying starts, new beads appear beside the old ones and the two copies are pulled to opposite ends.'],
  ['sp:rnap', 'RNA polymerase', 'Copies genes into mRNA when it bumps into one; genes that are already duplicated get copied twice as often.'],
  ['sp:mrna', 'mRNA', 'Working copies of genes, read by ribosomes until a degradosome destroys them.'],
  ['sp:ribosome', 'Ribosomes', 'Protein factories. Everything new in the cell, including more ribosomes, is made by them.'],
  ['sp:degradosome', 'Degradosomes', 'Destroy mRNAs on contact, so each mRNA makes only a burst of protein.'],
  ['sp:p:dnaA', 'DnaA', 'The starter: the first DnaA to bump into the origin bead opens it, and copying can begin.'],
  ['sp:p:replisome', 'Replisomes', 'DNA-copying machines. Two settle on the origin and become replication forks, copying one bead every 2 minutes in opposite directions.'],
  ['sp:p:ftsZ', 'FtsZ', 'Division protein. Once the cell is ready, FtsZ that reaches the membrane at midcell sticks there as the Z ring and pinches the cell in two.'],
  ['sp:p:fak', 'FakAB', 'Turns fatty acid that came in through the membrane into acyl phosphate.'],
  ['sp:p:pls', 'PlsYC (membrane)', 'Sits in the membrane and turns acyl phosphate into new lipid. Every lipid it makes grows the membrane, which stretches the cell.'],
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
    let sent = 0, logSent = 0;
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
            ...MACHINE_LAYERS.map(([id, label, about]) => ({ id, label, kind: 'species', on: true, about })),
            { id: 'grp:named', label: 'Other named proteins', kind: 'species', species: named, swatch: 'p:gapDH', on: false, about: 'Glycolysis enzymes, transporters and the rest of the modelled genes. Made here but not active in this milestone.' },
            { id: 'sp:other', label: 'Rest of the proteome', kind: 'species', on: false, about: 'The other ~430 genes’ proteins, five to a dot.' },
            { id: 'heat:fa', label: 'Fatty acid heatmap', kind: 'heat', field: sc.F.fa, on: false, about: 'Fatty acid entering through the membrane: the raw material for new membrane.' },
            { id: 'heat:ap', label: 'Acyl phosphate heatmap', kind: 'heat', field: sc.F.ap, on: false, about: 'Acyl phosphate made by FakAB, on its way to PlsYC in the membrane.' },
          ],
          howto: HOW_TO_READ + ' The purple outline is the membrane.',
          tips: [
            { label: 'Less fatty acid', detail: 'Halves the lipid supply: the DNA is copied in time, but the cell must wait to reach double size before it can divide.', set: [['fattyAcid', 0.5]] },
            { label: 'More fatty acid', detail: 'Doubles the lipid supply: the cell reaches double size early and then waits for the DNA to finish copying.', set: [['fattyAcid', 2]] },
            { label: 'Follow a fork', detail: 'Tap a pink replisome sitting on the chromosome to follow it; the panel says which part of the genome it is copying.' },
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
        const guide = { now: narrate(), events: sc.log.slice(logSent), labels: labels() };
        logSent = sc.log.length;
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
          guide,
        };
      },
    };

    // ------------------------------------------------------------ explanations
    function narrate() {
      const cell = sc.cell, rep = sc.rep, ring = sc.ring;
      const area = cell.area / sc.A0;
      const age = w.time * sc.boost - cell.born;
      const pct = Math.round(sc.copied() * 100);
      const just = cell.divisions.length && age < 240
        ? `The cell has just divided; the other daughter left and this one starts cycle ${cell.cycle}. ` : '';
      const grow = `PlsYC in the membrane keeps making lipid, so the cell keeps stretching (area ${num(area)}× a newborn's).`;
      if (ring.licensed) {
        const open = Number.isFinite(sc.shape.neck) ? Math.round((sc.shape.neck / sc.shape.r) * 100) : 100;
        return ring.members.length
          ? `Dividing. FtsZ that reaches the membrane at midcell sticks there as the Z ring (${ring.members.length} so far) and pinches the cell: the neck is ${open}% open. When it closes, each daughter keeps whatever is on its side.`
          : 'Both conditions are met: the DNA is copied and pulled apart, and the area has doubled. FtsZ is now gathering at midcell to form the Z ring.';
      }
      if (rep.done) {
        return area < 2
          ? `The chromosome is fully copied and the two copies are being pulled to opposite ends. The cell can't divide until its area has doubled. ${grow}`
          : 'The area has doubled and the DNA is copied; the two chromosomes are still being pulled apart before FtsZ can start the ring.';
      }
      if (rep.started && rep.forks.length < 2) return `${just}DnaA has opened the origin. Replisomes that bump into it settle there as replication forks (${rep.forks.length} of 2 so far). ${grow}`;
      if (rep.started) return `${just}Two replication forks are copying the chromosome in opposite directions, one 10 kbp bead every 2 minutes: ${pct}% done. Copied stretches are pulled towards opposite ends of the cell. ${grow}`;
      return `${just}The cell is growing. DnaA proteins are diffusing around until one bumps into the origin of replication on the chromosome and opens it. ${grow}`;
    }

    function labels() {
      const rep = sc.rep, ring = sc.ring;
      const out = [];
      if (!rep.done) out.push(labelAt(w, rep.chrom[0], rep.started ? 'origin (opened)' : 'origin of replication'));
      for (const f of rep.forks) if (!f.done) out.push(labelAt(w, f.i, 'replication fork'));
      if (rep.done) {
        out.push(labelCentre(w, rep.chrom, 'chromosome'));
        out.push(labelCentre(w, Array.from(rep.copy), 'its copy'));
      }
      if (ring.members.length) out.push(labelAt(w, ring.members[0], 'Z ring'));
      else if (!rep.started) out.push(labelAt(w, firstOf(w, sc.SP.dnaA), 'DnaA'));
      if (out.length < 4) out.push(labelAt(w, firstOf(w, sc.SP.pls), 'PlsYC making lipid'));
      return out.filter(Boolean).slice(0, 4);
    }
    return a;
  },
};
