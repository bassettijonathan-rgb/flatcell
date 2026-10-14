// Milestone 3 adapter: transcription, translation and mRNA decay in a cell.

import { createDogma, DOGMA_DEFAULTS } from './dogma.js';
import { CELL } from '../data/syn3a.js';
import { labelAt, firstOf, feed, num, HOW_TO_READ } from './guide.js';

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
    // Moments worth telling: the watched gene's mRNAs appearing and going.
    const moments = feed();
    let decays = 0, made = 0, shown = 0;
    // The first few of other genes too, so there is something to read straight away.
    ex.onMRNA = (k) => {
      made++;
      if (k === watchK()) moments.push(w.time * sc.boost, `RNA polymerase finished copying the ${rows[k].name} gene: a new ${rows[k].name} mRNA. Ribosomes that bump into it will make a burst of ${rows[k].name}.`);
      else if (shown < 3 && rows[k].id !== 'other' && ++shown) moments.push(w.time * sc.boost, `A new ${rows[k].name} mRNA, copied from its gene by RNA polymerase.`);
      else if (made % 100 === 0) moments.push(w.time * sc.boost, `${made} mRNAs made so far across all genes.`);
    };
    ex.onDecay = (k, life, made) => {
      decays++;
      if (k === watchK() || (decays <= 2 && rows[k].id !== 'other')) moments.push(w.time * sc.boost, `A degradosome destroyed a ${rows[k].name} mRNA after ${num(life / 60)} min; it had started ${made} ${made === 1 ? 'protein' : 'proteins'}.`);
      else if (decays % 100 === 0) moments.push(w.time * sc.boost, `${decays} mRNAs destroyed so far, each after making ${num(ex.burstSum / ex.burstN)} proteins on average.`);
    };
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
            { id: 'sp:dna', label: 'Chromosome', kind: 'species', on: true, about: 'The chromosome, 54 beads of about 10 kbp each, held still in the middle of the cell. Each gene sits on one bead.' },
            { id: 'sp:rnap', label: 'RNA polymerase', kind: 'species', on: true, about: 'RNA polymerase. When it bumps into a gene’s bead it may start copying the gene into mRNA (25 letters a second); it stays there until done.' },
            { id: 'sp:mrna', label: 'mRNA', kind: 'species', on: true, about: 'A messenger RNA, the working copy of one gene. It drifts away from the chromosome; bright centre: ribosomes are reading it.' },
            { id: 'sp:ribosome', label: 'Ribosomes', kind: 'species', on: true, about: 'Ribosomes, the protein factories. One that bumps into an mRNA may latch on and make one protein (12 amino acids a second).' },
            { id: 'sp:degradosome', label: 'Degradosomes', kind: 'species', on: true, about: 'RNase J degradosomes. One that bumps into an mRNA may destroy it, which ends that mRNA’s burst of protein.' },
            ...(machineSp.has(watchSp) ? [] : [{ id: 'sp:' + w.species[watchSp].name, label: `${watched.name} (watched)`, kind: 'species', on: true, about: `${watched.name} proteins, the gene you are watching, drawn in orange. New ones appear next to the ribosome that made them.` }]),
            { id: 'grp:named', label: 'Other named proteins', kind: 'species', species: productNames, about: 'Proteins of the other modelled genes (glycolysis, transporters, lipid and division enzymes), coloured by their job.', swatch: 'p:' + (rows.find((g, j) => j !== k && g.role === 'glycolysis')?.id || 'gapDH'), on: true },
            { id: 'sp:other', label: 'Rest of the proteome', kind: 'species', on: false, about: 'The other ~430 genes’ proteins, five to a dot. Hidden by default to keep the view clear.' },
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
          howto: HOW_TO_READ,
          tips: [
            { label: 'Watch FtsZ', detail: 'A rarer mRNA: FtsZ comes in fewer, bigger steps. The charts restart for the new gene.', set: [['watch', 'ftsZ']] },
            { label: 'Quarter the ribosomes', detail: 'Fewer ribosomes catch each mRNA less often, so bursts shrink, and naked mRNAs are destroyed sooner.', set: [['ribosomes', 0.25]] },
            { label: 'More degradosomes', detail: 'Four times the degradosomes: mRNAs last about half a minute and bursts drop to a few proteins.', set: [['degradosomes', 4]] },
          ],
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

      describe(i) { return describeExpression(w, ex, i, sc.spDNA); },

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
        // What is happening, in words, and labels for the view.
        const g = rows[k];
        const mid = sc.beads[Math.floor(sc.beads.length / 2)];
        let wm = -1, bm = -1, br = -1;
        for (let i = 0; i < w.cap; i++) {
          if (!w.alive[i]) continue;
          if (w.kind[i] === ex.sp.mrna) { if (w.aux[i] === k && wm < 0) wm = i; if (w.state[i] > 0 && bm < 0) bm = i; }
          else if (w.kind[i] === ex.sp.ribosome && w.state[i] > 0 && br < 0) br = i;
        }
        const every = 1 / (g.mSlab * g.kDeg) / 60;
        let now = `${mrnaNow} mRNA${mrnaNow === 1 ? '' : 's'} in the cell right now, and ${busy.ribosome[0]} of ${busy.ribosome[1]} ribosomes are making a protein. `;
        now += ex.mrnaNow[k] > 0
          ? `A ${g.name} mRNA exists: each ribosome that bumps into it makes one ${g.name}, until a degradosome finds it. Expect about ${num(g.burst)} new ${g.name} in this burst.`
          : `There is no ${g.name} mRNA at the moment, so no ${g.name} is being made and its count drifts down as the cell grows. A new one comes along about every ${num(every)} min of cell time.`;
        const labels = [
          labelAt(w, mid, 'chromosome'),
          wm >= 0 ? labelAt(w, wm, `${g.name} mRNA`) : bm >= 0 ? labelAt(w, bm, 'mRNA being translated') : null,
          br >= 0 && (wm < 0 || w.link[br] !== wm) ? labelAt(w, br, 'ribosome at work') : null,
          labelAt(w, firstOf(w, ex.sp.degradosome), 'degradosome'),
        ].filter(Boolean);
        return {
          guide: { now, events: moments.take(), labels },
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

// What an expression particle is doing, for the follow panel.
export function describeExpression(w, ex, i, spDNA) {
  const rows = ex.rows;
  const kd = w.kind[i];
  if (kd === ex.sp.rnap) return w.state[i] > 0 ? `copying ${rows[w.state[i] - 1].name}` : 'searching for a promoter';
  if (kd === ex.sp.ribosome) return w.state[i] > 0 ? `making ${rows[w.state[i] - 1].name}` : 'free';
  if (kd === ex.sp.mrna) {
    const g = rows[w.aux[i]];
    return `${g.name} mRNA · ${w.state[i]} ribosome${w.state[i] === 1 ? '' : 's'} on it · ${w.prog[i]} started so far`;
  }
  if (kd === spDNA) return w.state[i] > 0 ? 'a gene here is being transcribed' : 'chromosome';
  return null;
}

export function geneCard(g, k, sc) {
  const ex = sc.ex;
  const other = g.id === 'other';
  const rows = [
    ['Locus', g.loci.join(', ')],
    ...(other ? [] : [['Genome position', `${(g.start / 1000).toFixed(1)} kbp of ${(CELL.genomeBp / 1000).toFixed(1)}`]]),
    ['Protein length', g.parts > 1 ? `${g.aa} aa in ${g.parts} parts` : `${other ? '~' : ''}${g.aa} aa`],
    ['Copies per syn3A cell', Math.round(g.copies).toLocaleString('en-US')],
    ['In this cell slice', `${Math.round(g.copies * sc.share).toLocaleString('en-US')}${other ? ` (as ${Math.round(ex.counts[k])} lumps of 5)` : ''}`],
    ['mRNAs per syn3A cell', `${+g.mrna.toPrecision(3)} on average${g.parts > 1 ? `, across ${g.parts} genes` : ''}`],
    [g.parts > 1 ? 'Parts per mRNA' : 'Proteins per mRNA', `${g.burst.toFixed(1)} needed to keep up with growth`],
    ['Transcript', `${g.nt.toLocaleString('en-US')} nt, ${(g.nt / 25).toFixed(0)} s to copy${g.parts > 1 ? ' (one part)' : ''}`],
    ['Translation', `${(g.partAa / 12).toFixed(0)} s per ${g.parts > 1 ? 'part' : 'protein'} at 12 aa/s`],
  ];
  if (g.rate && !other) rows.push(['Activity', g.rate]);
  return { id: g.id, name: g.name, loci: g.loci, product: g.product, role: g.role, rows };
}
