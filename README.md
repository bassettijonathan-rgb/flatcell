# Flatcell

A 2D browser simulation of JCVI-syn3A, the minimal bacterium, built from one
rule: molecules move by Brownian motion, and enzymes only react with what they
bump into. Rates are not written into the model. Michaelis–Menten curves,
crowding slowdowns, metabolic flux, expression bursts and cell division
have to emerge from encounters on a lattice.

Plain JavaScript ES modules, no build step for development, no framework. The
simulation runs in a Web Worker; drawing uses WebGPU, then WebGL2, then
Canvas 2D, whichever the browser offers. The same code ships as a single-file
page that runs as a claude.ai Artifact, down to phone width.

## Milestones

| | Scenario | Status |
|---|---|---|
| 1 | **Test tube**: one syn3A enzyme and its substrate. Michaelis–Menten curves emerge and match theory; crowding sliders show the slowdown. | done |
| 2 | **Glycolysis box**: the pathway from glucose to lactate making ATP, with a channelling demo (clustered vs spread enzymes). | done |
| 3 | **Central dogma**: transcription and translation with stochastic bursts in live copy numbers. | done |
| 4 | **Whole cell**: grows its membrane, copies its DNA and divides at least once. | done |

## Running it

```sh
python3 -m http.server 8080        # or any static file server
open http://localhost:8080/        # index.html loads src/app/main.js

npm test                           # kinetics, determinism and core tests (Node 20+)
npm run build                      # dist/flatcell.html (Artifact) and dist/index.html
node test/browser/artifact-check.mjs   # needs Playwright; boots the built page in a sandboxed iframe
python3 tools/check_syn3a.py DATA_DIR  # checks src/data/syn3a.js against the source tables
```

`?renderer=webgpu|webgl|canvas` forces a drawing backend. The page opens on the
newest milestone; `#m1`, `#m2` … in the link open a specific one.

### Reading the page

Every milestone explains itself while it runs. Under the view, **What's
happening** says in a sentence or two what the simulation is doing right now,
with the latest notable moments (an origin opening, a bottleneck moving, an
mRNA being destroyed) listed beneath it with their times. Labels on the view
point at the particles those sentences talk about; **Hide labels** turns them
off. In the side panel, **What the dots are** is a key to every colour, and
**Try this** buttons change the settings to show one effect at a time. Each
scenario adapter supplies these as `info().layers[].about`, `info().howto`,
`info().tips` and `stats().guide`.

## How the model works

**Space.** The cell is a slab one site thick: a square lattice of 10 nm sites,
10 nm deep, so one molecule in one site is 1.66 mM. Each site has four slots.
A small protein takes one, a 150–700 kDa complex two, and a ribosome, DNA bead
or crowder fills all four.

**Proteins** are particles. Each step (4 µs in the test tube) a particle tries
to hop to a random neighbour with probability 4·D·dt/a², and moves only if
the site has room and is in its compartment. D comes from mass, scaled from
GFP in the *E. coli* cytoplasm (7.7 µm²/s at 27 kDa, Elowitz et al. 1999) by
the cube root of mass. Crowding is nothing more than full sites getting in the
way.

**Small molecules** (glucose, ATP, NTPs, amino acids, intermediates) are
concentration fields on the same lattice, diffused every 10 steps with an
implicit, mass-conserving ADI scheme. Sites filled by a large particle are
closed to them.

**Enzymes** are small Markov chains over how many substrates they hold
(ordered binding: E → ES → ESS … → E + products). A free enzyme soaks up
substrate from its own site as a linear sink, at a per-site rate kSite, and
binds once it has gathered a random, exponentially distributed amount (one
molecule on average; each binding costs exactly one molecule, so mass is
conserved and a site never goes negative). Bound substrate leaves at koff;
the full complex turns over at kcat and drops its products into the site.
Within each step the chain runs in continuous time, so dwell times have the
right means however coarse the step.

**Calibration, not hard-coding.** kcat and Km are the measured syn3A values.
What the lattice needs is kSite and koff, which are solved so that the
*emergent* Km and kcat land on the measured ones once 2D diffusion is
accounted for (see simplification 2). Nothing in the rate of product
formation is set directly: it is counted from catalytic events.

**Determinism.** A seeded sfc32 generator drives everything; the few
transcendental functions the model needs (1 − e^−x and −ln u) are computed
with + − × ÷ only, and derived constants are rounded to 12 significant
digits, so a seed gives the same run in every engine. The **Fingerprint**
button hashes the full state; `test/determinism.test.mjs` checks seeded
reruns are identical.

## Milestone 1 results

`npm test` sweeps substrate through 0.25, 1 and 4 × Km and compares the
counted turnover per enzyme with v = kcat·S/(Km+S):

| Run | Deviation from Michaelis–Menten |
|---|---|
| TpiA, 60 enzymes, uncrowded | within ±2.5% (±1.3% counting noise) |
| TpiA, 60 enzymes, 30% crowded | within ±2.5% |
| Pgi, 40 enzymes | within 10% (test bound) |

The pass bar is 10%. Crowding halves enzyme diffusion (6.1 → 2.6 µm²/s
measured from the particles' mean squared displacement) but barely moves the
TpiA curve, because TpiA with Km ≈ 1 mM is limited by catalysis, not by
encounters. That is the real behaviour of a reaction-limited enzyme. To see
crowding slow a reaction, switch **Kinetics** to *Diffusion-limited enzyme*
(substrate diffusion 1 µm²/s, every encounter almost always productive): at
40% crowding the low-substrate turnover drops by about 30%, and the test
suite checks it drops by more than 15%.

## Milestone 2 results

The glycolysis box is a 10 nm slab of cytoplasm about the size of a syn3A
cross-section (1,496 sites inside a membrane rim). Its eleven enzymes, from
the PTS glucose transporter to lactate dehydrogenase, are particles at
syn3A copy numbers scaled to the slab (60 GapDH, 49 Ldh, 45 Eno … 10 FbaA;
23 PTS in the membrane), and the rest of the proteome is 520 inert lumps plus
20 ribosomes. The 15 metabolites start at the Thornburg et al. 2022 levels.
Nothing about the pathway's flux is set: each step's rate is counted from
catalytic events.

What emerges, and what `test/glycolysis.test.mjs` checks:

- **ATP is made.** PGK and pyruvate kinase make more ATP than PfkA spends;
  at the default demand (a quarter of the ATP pool spent per second) ATP
  holds near 3.7 mM.
- **Aldolase is the bottleneck.** FbaA (10 copies, kcat 60 /s) runs at its
  full capacity while every other step has slack, so fructose
  1,6-bisphosphate piles up above it and PEP runs nearly dry below. Two ATP
  per glucose through ten aldolases caps ATP supply near 1.3 mM/s, so an ATP
  demand above about 0.35 /s slowly drains the pool.
- **Pools are conserved.** ATP + ADP and NAD⁺ + NADH, counting what enzymes
  hold, stay constant to 1e-9.

**Channelling.** The second scene isolates GapDH → 1,3-bisphosphoglycerate →
Pgk at syn3A copy numbers, with 1,3-BPG lost to other fates at a set rate.
Clustering the enzymes in one patch helps only when the intermediate is lost
within roughly the cluster's size (share of 1,3-BPG reaching Pgk, 0.6 s of
cell time each, ~2,700 molecules made):

| 1,3-BPG lost at | 1,3-BPG diffusion | spread | clustered |
|---|---|---|---|
| 300 /s (range 1.6 µm) | 200 µm²/s | 52% | 51% |
| 20,000 /s (range 200 nm) | 200 µm²/s | 2.6% | 5.1% |
| 3,000 /s (range 80 nm) | 5 µm²/s | 12% | 18% |

So proximity doubles what a free, fast metabolite delivers, but most of it
still escapes: proximity alone is a weak channel unless the intermediate is
held back.

## Milestone 3 results

The central-dogma cell is a 400 nm disc (1,124 cytoplasm sites inside a
membrane rim) with the chromosome as 54 frozen beads of about 10 kbp each in
the middle. Each of the 21 modelled genes sits on the bead covering its
genome position; a 22nd row, "other genes", carries the rest of the proteome
and is spread over every bead, so polymerases and ribosomes carry their real
load. Machinery and proteins start at syn3A copy numbers scaled to the slab
(6 RNA polymerases, 17 ribosomes, 4 degradosomes, 45 GapDH …, and the rest
of the proteome as lumps of five proteins).

Three things happen, each only on contact:

- an RNA polymerase next to a promoter may start a transcript; it stays on
  the gene for the copying time (25 nt/s), then lets a new mRNA go;
- a free ribosome next to an mRNA may start translating; it holds the mRNA
  still for the translation time (12 aa/s) and then releases a protein;
- a degradosome next to an mRNA may destroy it.

Each contact chance is set from syn3A's targets (mRNA count per gene,
2-minute half-life, and enough proteins per mRNA to keep each level through
a 105-minute doubling), then scaled by one measured factor per process so
the lattice reproduces them. That is the same move as tuning an enzyme's
site probability to its kcat and Km. Slow processes run 1,000× faster than
diffusion, so the page shows about an hour of cell time per minute.

What emerges, and what `test/dogma.test.mjs` checks (seed 1, 1.4 h of cell
time after a warm-up):

| | Lattice | syn3A target |
|---|---|---|
| mRNAs in the cell, time average | 4.7 | 4.7 |
| mRNA half-life | 2.0 min (1.9–2.1 over four seeds) | 2 min |
| Proteins per mRNA | 13.5 | 14.8 |
| Variance / mean of proteins per mRNA | 17.7 | about 16 for geometric bursts |

- **Bursts.** Each mRNA is translated until a degradosome finds it, so the
  number of proteins per mRNA follows the geometric distribution of that
  race, and a gene's protein count climbs in steps when one of its rare
  mRNAs appears (GapDH, the most transcribed gene here, gets one about every
  40 minutes of cell time) and drifts down between them.
- **Ribosomes protect mRNA.** Contact chances are calibrated at syn3A levels
  and then left alone. With 4× the ribosomes, mRNAs live about 4.4 min and
  make about 48 proteins each; with a quarter, 1.2 min and 3 proteins.
  Ribosomes crowd round the mRNA they are reading and keep degradosomes off
  it. Four times the degradosomes shortens mRNA life to about 0.6 min and
  bursts to 5.6.

## Milestone 4 results

The whole cell starts as the milestone-3 disc and adds what a cycle needs:

- **Membrane growth from encounters.** Fatty acid enters through every
  membrane site, FakAB in the cytoplasm turns it into acyl phosphate, and
  PlsYC in the membrane turns that into lipid, each on encounter with the
  enzyme's measured Km. Lipid synthesis is a growth process, so like
  transcription it runs 1,000× faster than diffusion. The cell's area
  follows its lipid (23 lipids per 100 nm² of area), so the disc stretches
  into a capsule.
- **Replication.** DnaA opens the origin bead on contact. Each of the two
  replisomes that then reach the origin takes a fork and copies one 10 kbp
  bead every 134 s (75 bp/s), with copies of the genes it passes
  transcribed from then on.
- **Segregation.** Copied beads are drawn towards opposite poles, the old
  chromosome to one, the copy to the other.
- **Division.** Once the DNA is copied, the two chromosomes are apart, and
  the area has doubled, FtsZ that reaches the membrane at midcell joins a Z
  ring. The ring pinches the cell at a speed set by how much FtsZ it holds
  (10 min for a full ring). At the cut, everything on the far side leaves
  with the other daughter, and the view recentres on the one left.

What `test/wholecell.test.mjs` checks (seed 1):

| | Lattice | syn3A |
|---|---|---|
| First cycle | 105 min | 105 min doubling |
| Replication, origin to terminus | 61 min | about 60 min at 75 bp/s |
| DNA at division | one whole chromosome per daughter | |
| Contents | split between daughters, none lost | |

The daughter then starts its next cycle. Proteins are partitioned at random,
so a daughter can be short of one: in seed 1 the kept daughter gets 26 of
35 ribosomes. On this machine's headless Chromium a cycle takes about four
minutes of real time (7,000 steps per second, about 30 s of cell time per
second).

## Every simplification

1. **Two dimensions.** The cell is a 10 nm slab, not a 400 nm sphere. Copy
   numbers are scaled to the slab's share of the cell volume, keeping
   concentrations (not counts) equal to syn3A's.
2. **2D encounter rates are recalibrated.** In 3D the diffusion-limited rate
   is 4πDR and independent of how far apart enzymes are. In 2D it depends on
   spacing: for one absorbing site in a catchment of radius b sites, the
   lattice Green's function gives kD = 2πDh / (ln b + γ + 1.5 ln 2 − 3/4).
   Every enzyme's per-site binding rate is set from 1/kon = 1/kSite + 1/kD so
   the effective association rate matches its 3D target, and koff is solved so
   Km = (koff + kcat)/kSite + kcat/kD. Association is capped at half the 2D
   limit; where Km is below what 2D diffusion allows, koff is set to zero.
3. **Small molecules are mean fields.** They are concentrations, not
   particles; a site can hold a fraction of a molecule. Enzymes capture from
   the field as a linear sink with a random threshold, which reproduces mean
   binding times but not the exact waiting-time distribution of a single
   molecule arriving.
4. **Fields update every 10 steps.** Between updates a release would sit in
   its site and be rebound at once. Releases (and captures) are partly hidden
   from binding by the share diffusion would already have carried away,
   1 − 1/(1 + 4Dτ/a²), until the next update.
5. **Diffusion coefficients come from mass**, scaled from GFP's in-cytoplasm
   value, not measured per protein. Because that value already includes the
   cell's crowding, adding crowders on top overstates the slowdown somewhat.
6. **Crowders are inert stand-ins**: 160 kDa particles that fill a site and
   keep small molecules out. Real cytoplasm is a mixture of everything else.
7. **Irreversible, ordered binding.** Each enzyme binds its substrates in a
   fixed order and runs forward only; reverse reactions and product inhibition
   are left out. kcat and Km are the forward values from the balanced
   parameter table of Thornburg et al. 2022.
8. **The test tube is a chemostat.** Substrate is held at the set mean by a
   uniform top-up each field update, and product is washed out, so the
   heatmaps reach a steady state.
9. **The diffusion-limited enzyme is hypothetical.** It catches substrate on
   4 of 5 encounters and never lets go; its reference curve assumes enzymes
   evenly spread, and randomly placed ones measure about 15% below it because
   neighbours compete for the same substrate.
10. **Particles hop on a grid.** Directions are the four lattice axes and
    collisions are site occupancy, not shapes. Slots let up to four small
    proteins share a 10 nm site.
11. **Time is real in milestones 1 and 2.** The test tube runs at 4 µs per step,
    so the page shows slow motion. Later milestones compress slow processes
    (transcription, translation, replication, growth) relative to metabolism
    and the speed control shows by how much.
12. **Glycolysis runs forward only.** Every step is irreversible, so
    near-equilibrium steps (Pgi, TpiA, Pgm, Eno) cannot run backwards and
    there is no allosteric control (PfkA is not inhibited by ATP). This is
    why fructose 1,6-bisphosphate can pile up behind aldolase.
13. **Multi-substrate enzymes bind in a fixed order** and each binding step
    is calibrated as if its substrate were the only one, so their apparent
    Km values are approximate.
14. **One particle per counted protein.** Copy numbers count polypeptides;
    each particle is one of them with the measured kcat, but it diffuses
    with the mass of the native oligomer.
15. **Left out of the box:** phosphate (GapDH's third substrate), the
    PTS's own phosphorelay (folded into one step with a glucose saturation
    factor, Km 0.1 mM), every pathway that branches off glycolysis, and
    lactate export, which is a first-order leak at 5 /s.
16. **ATP demand is a first-order sink** standing for everything else the
    cell spends ATP on. Milestones 3 and 4 do not track ATP.
17. **The channelling loss is a free parameter.** 1,3-BPG's real competing
    fates are slow; the loss rate is a knob that sets how far it travels,
    and the clustered enzymes are held still as a scaffold would hold them.

18. **Slow processes are boosted** 1,000× relative to diffusion in milestone
    3: transcription, translation, mRNA decay and dilution all run fast while
    molecules move at their real speed. A burst therefore spreads less far
    from its mRNA than it would in a real cell.
19. **Contact chances are calibrated, not derived.** A well-mixed estimate
    of how often two particles meet sets each chance; the lattice makes
    meetings rarer (ribosomes are big and slow, new mRNAs start in the
    nucleoid), so transcription, translation and decay chances carry
    measured factors of 1.41, 3.0 and 1.85 (`CONTACT_CAL` in
    `src/scenarios/dogma.js`; `tools/m3cal.mjs` measures them).
20. **Genes are single promoters.** A multi-subunit complex is one row on
    one promoter: its mRNAs are the sum over its genes (52 for the
    ribosome's proteins, 4 for RNA polymerase), each mRNA makes one part, and
    the complex appears when all its parts are made. rRNA is not modelled.
    The "other genes" row stands for about 430 genes, every mRNA has the same
    intrinsic decay chance, and there is no regulation: promoter strength is
    set from the measured mRNA counts.
21. **The chromosome is a chain of frozen beads.** Beads move only when
    segregation pulls them; only the RNA polymerase on a gene is held still;
    the transcript's 5' end is not available to ribosomes until the copy is
    finished (no coupling of transcription and translation).
22. **One ribosome or polymerase per particle, any number per mRNA.** A
    ribosome reads the whole mRNA in one go; ribosomes do not queue along it.
23. **The milestone-3 cell does not grow.** Machinery stays at syn3A levels
    (new RNA polymerases, ribosomes and degradosomes are counted but not
    added), and every other protein particle leaves at the growth rate, which
    stands in for dilution. Amino acids and nucleotides are not tracked.
24. **Translation speed is a bacterial average.** syn3A's own elongation
    rate is not measured; 12 aa/s is in the 10–20 aa/s bacterial range.

25. **Lipid supply is a set rate.** Fatty acid uptake (37 molecules per
    membrane site per second, at the boosted clock) is the one number chosen
    to give a 105-minute doubling; there is no syn3A uptake measurement to
    use. ATP and glycerol 3-phosphate are taken as saturating for FakAB and
    PlsYC, and glycolysis is not run in the whole cell.
26. **Area follows lipid.** In 3D a sphere's volume grows faster than its
    surface; in the slab the cell's area is simply proportional to the lipid
    made, and the cell keeps its 200 nm radius as it stretches.
27. **A floor on mRNA per gene in the whole cell.** The slab holds 3.4% of
    the cell's proteins but a whole chromosome, so most genes would have an
    mRNA only every few hours and some cycle proteins (DnaA, five copies)
    would run out after a division. In milestone 4 each gene has at least
    0.2 mRNAs on average, with proportionally fewer proteins per mRNA, which
    keeps each protein's mean output and smooths it.
28. **Initiation, segregation and constriction are simple rules.** DnaA
    opens the origin with a contact chance set for a 5-minute wait at
    birth copy numbers (no DnaA-ATP cycle or titration); chromosomes are
    pulled to their poles by a bias, not by entropy or a partition system;
    the ring's speed scales with its FtsZ up to eight.
29. **One daughter is followed.** The other leaves the simulation at
    division.

## Data sources

- Protein copy numbers: Breuer et al. 2019, *eLife* 8:e36842 (proteomics,
  77,028 proteins per average cell).
- mRNA counts, kinetic parameters and concentrations: the Luthey-Schulten lab
  [Minimal_Cell](https://github.com/Luthey-Schulten-Lab/Minimal_Cell)
  repository (CME_ODE/model_data), from Thornburg et al. 2022, *Cell*
  185:345. `tools/check_syn3a.py` checks every kcat, Km and mRNA count in
  `src/data/syn3a.js` against those files.
- Ribosomes (503), RNA polymerases (187), cell radius (200 nm), mRNA
  half-life (~2 min), degradosomes (120): Thornburg et al. 2022.
  Transcription 25 nt/s: Thornburg et al. 2019. Doubling time 105 min:
  Breuer et al. 2019. Fork speed: chosen to copy 543 kbp in about an hour
  with two forks.
- GFP cytoplasmic diffusion: Elowitz et al. 1999, *J. Bacteriol.* 181:197.

## Layout

```
src/core/       lattice world, particles, fields, units, RNG
src/data/       syn3A gene and reaction tables
src/scenarios/  one module per milestone (testtube, glycolysis, ...) plus shared helpers
src/worker/     simulation host (runs in a Web Worker or on the page)
src/app/        page: renderers, charts, panels
test/           node:test suites; test/browser has page checks
tools/          single-file Artifact build, data checker
```
