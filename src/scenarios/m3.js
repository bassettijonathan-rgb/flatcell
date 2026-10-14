// Milestone 3 adapter: transcription, translation and mRNA decay in a cell.

import { createDogma, DOGMA_DEFAULTS } from './dogma.js';
import { CELL } from '../data/syn3a.js';

const BIN = 3;          // proteins per histogram bin
const NBINS = 16;       // last bin collects everything above
const WATCH_COLOR = [0.95, 0.36, 0.2];

export const M3 = {
  id: 'm3',
  title: 'Central dogma',
  blurb: 'A 400 nm syn3A cell with its chromosome in the middle. RNA polymerases copy genes when they bump into a promoter, ribosomes translate an mRNA when they bump into it, and degradosomes destroy it the same way. Proteins arrive in bursts, one burst per mRNA.',
  defaults: DOGMA_DEFAULTS,

  create(options) {
    const sc = createDogma(options);
    const w = sc.world, ex = sc.ex, opts = sc.opts;
    const rows = ex.rows;
    const genes = {};
    rows.forEach((g, k) => { genes[g.id] = geneCard(g, k, sc); });

    // Expected translations per mRNA: each mRNA is translated until it is
    // destroyed, a race that gives a geometric distribution with the gene's
    // mean. The cell's histogram mixes genes by how many mRNAs they make.
    const wsum = rows.reduce((a, g) => a + g.mrna, 0);
    const bMean = rows.reduce((a, g) => a + g.mrna * g.burst, 0) / wsum;
    const expected = new Float64Array(NBINS);
    for (const g of rows) {
      const q = g.burst / (1 + g.burst);
      for (let n = 0; n < 400; n++) expected[Math.min(NBINS - 1, Math.floor(n / BIN))] += (g.mrna / wsum) * (1 - q) * q ** n;
    }
    const mrnaTarget = rows.reduce((a, g) => a + g.mrna, 0) * sc.share;
    let sent = 0, epoch = sc.epoch;

    const watchK = () => ex.idx[opts.watch] ?? ex.idx.gapDH;
    const machineSp = new Set([ex.sp.rnap, ex.sp.ribosome, ex.sp.degradosome]);

    const a = {
      sc,
      world: w,
      opts,
      viewBox: [3, 3, w.W - 3, w.H - 3],

      info() {
        const k = watchK();
        const watchSp = ex.product[k];
        const watched = rows[k];
        const productNames = rows.filter((g, j) => !machineSp.has(ex.product[j]) && g.id !== 'other' && j !== k).map((g) => 'p:' + g.id);
        const species = w.species.map((sp, j) => ({
          name: sp.name, label: sp.label, radius: sp.radius, gene: sp.gene,
          color: j === watchSp ? WATCH_COLOR : sp.color,
        }));
        return {
          id: 'm3',
          title: M3.title,
          blurb: M3.blurb,
          species,
          fields: [],
          layers: [
            { id: 'sp:dna', label: 'Chromosome', kind: 'species', on: true },
            { id: 'sp:rnap', label: 'RNA polymerase', kind: 'species', on: true },
            { id: 'sp:mrna', label: 'mRNA', kind: 'species', on: true },
            { id: 'sp:ribosome', label: 'Ribosomes', kind: 'species', on: true },
            { id: 'sp:degradosome', label: 'Degradosomes', kind: 'species', on: true },
            ...(machineSp.has(watchSp) ? [] : [{ id: 'sp:' + w.species[watchSp].name, label: `${watched.name} (watched)`, kind: 'species', on: true }]),
            { id: 'grp:named', label: 'Other named proteins', kind: 'species', species: productNames, swatch: 'p:' + (rows.find((g, j) => j !== k && g.role === 'glycolysis')?.id || 'gapDH'), on: true },
            { id: 'sp:other', label: 'Rest of the proteome', kind: 'species', on: false },
          ],
          controls: [
            { id: 'watch', label: 'Watch gene', type: 'select', value: rows[k].id,
              options: rows.filter((g) => g.id !== 'other').map((g) => ({ value: g.id, label: `${g.name} · ${g.copies.toLocaleString('en-US')} per cell` })) },
            { id: 'ribosomes', label: 'Ribosomes', type: 'log', min: 0.25, max: 4, value: opts.ribosomes, unit: '× syn3A', rebuild: true, hint: `${Math.round(ex.counts[ex.idx.ribosome] * opts.ribosomes)} in this cell; syn3A level gives ${Math.round(ex.counts[ex.idx.ribosome])}` },
            { id: 'degradosomes', label: 'Degradosomes', type: 'log', min: 0.25, max: 4, value: opts.degradosomes, unit: '× syn3A', rebuild: true, hint: 'more of them shortens mRNA life, and with it each burst' },
          ],
          actions: [],
          gene: genes[rows[k].id],
          genes,
          clock: { dt: w.dt, boost: sc.boost, unit: 'cell time' },
        };
      },

      step() { sc.step(); },

      control(id, value) {
        if (id === 'watch') { sc.setWatch(value); return 'info'; }
        if (id === 'ribosomes' || id === 'degradosomes') return { ...opts, [id]: value };
        return null;
      },

      action() { return null; },

      busy(i) { return w.state[i] > 0 && w.kind[i] !== sc.spDNA; },

      describe(i) {
        const kd = w.kind[i];
        if (kd === ex.sp.rnap) return w.state[i] > 0 ? `copying ${rows[w.state[i] - 1].name}` : 'searching for a promoter';
        if (kd === ex.sp.ribosome) return w.state[i] > 0 ? `making ${rows[w.state[i] - 1].name}` : 'free';
        if (kd === ex.sp.mrna) {
          const g = rows[w.aux[i]];
          return `${g.name} mRNA · ${w.state[i]} ribosome${w.state[i] === 1 ? '' : 's'} on it · ${w.prog[i]} started so far`;
        }
        if (kd === sc.spDNA) return w.state[i] > 0 ? 'a gene here is being copied' : 'chromosome';
        return null;
      },

      stats() {
        const k = watchK();
        let mrnaNow = 0;
        for (let j = 0; j < rows.length; j++) mrnaNow += ex.mrnaNow[j];
        const busy = { rnap: [0, 0], ribosome: [0, 0], rnj: [0, 0] };
        for (let i = 0; i < w.cap; i++) {
          if (!w.alive[i]) continue;
          const kd = w.kind[i];
          const b = kd === ex.sp.rnap ? busy.rnap : kd === ex.sp.ribosome ? busy.ribosome : kd === ex.sp.degradosome ? busy.rnj : null;
          if (b) { b[1]++; if (w.state[i] > 0) b[0]++; }
        }
        const L = ex.lifetimes, B = ex.bursts;
        let ls = 0; for (const v of L) ls += v;
        let bs = 0;
        const hist = new Float64Array(NBINS);
        for (const v of B) { bs += v; hist[Math.min(NBINS - 1, Math.floor(v / BIN))]++; }
        // Rows sampled since the last frame; the page keeps the long history.
        if (epoch !== sc.epoch) { epoch = sc.epoch; sent = 0; }
        const fresh = Math.min(sc.history.length, sc.sampled - sent);
        const newRows = sc.history.slice(sc.history.length - fresh);
        sent = sc.sampled;
        return {
          watch: { id: rows[k].id, name: rows[k].name, mrna: ex.mrnaNow[k], prot: ex.protNow[k], made: ex.protMade[k], start: ex.counts[k], burst: rows[k].burst },
          epoch,
          newRows,
          mrnaNow,
          mrnaTarget,
          lifeMean: L.length ? ls / L.length : 0,
          lifeN: ex.lifetimeN,
          lifeTarget: 1 / rows[0].kDeg,
          burstMean: B.length ? bs / B.length : 0,
          burstN: ex.burstN,
          bMean,
          hist: Array.from(hist),
          expected: Array.from(expected),
          bin: BIN,
          busy,
          made: { mrna: ex.mrnaMade.reduce((x, y) => x + y, 0), prot: ex.protMade.reduce((x, y) => x + y, 0) },
        };
      },
    };
    return a;
  },
};

function geneCard(g, k, sc) {
  const ex = sc.ex;
  const other = g.id === 'other';
  const rows = [
    ['Locus', g.loci.join(', ')],
    ...(other ? [] : [['Genome position', `${(g.start / 1000).toFixed(1)} kbp of ${(CELL.genomeBp / 1000).toFixed(1)}`]]),
    ['Protein length', `${other ? '~' : ''}${g.aa} aa`],
    ['Copies per syn3A cell', Math.round(g.copies).toLocaleString('en-US')],
    ['In this cell slice', `${Math.round(g.copies * sc.share).toLocaleString('en-US')}${other ? ` (as ${Math.round(ex.counts[k])} lumps of 5)` : ''}`],
    ['mRNAs per syn3A cell', `${+g.mrna.toPrecision(3)} on average`],
    ['Proteins per mRNA', `${g.burst.toFixed(1)} needed to keep up with growth`],
    ['Transcript', `${g.nt.toLocaleString('en-US')} nt, ${(g.nt / 25).toFixed(0)} s to copy`],
    ['Translation', `${(g.aa / 12).toFixed(0)} s per protein at 12 aa/s`],
  ];
  if (g.rate && !other) rows.push(['Activity', g.rate]);
  return { id: g.id, name: g.name, loci: g.loci, product: g.product, role: g.role, rows };
}
