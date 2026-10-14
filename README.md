# Flatcell

A 2D browser simulation of JCVI-syn3A, the minimal bacterium, built from one
rule: molecules move by Brownian motion, and enzymes only react with what they
bump into. Rates are not written into the model. Michaelis–Menten curves,
crowding slowdowns and (in later milestones) metabolic flux, expression bursts
and cell division have to emerge from encounters on a lattice.

Plain JavaScript ES modules, no build step for development, no framework. The
simulation runs in a Web Worker; drawing uses WebGPU, then WebGL2, then
Canvas 2D, whichever the browser offers. The same code ships as a single-file
page that runs as a claude.ai Artifact, down to phone width.

## Milestones

| | Scenario | Status |
|---|---|---|
| 1 | **Test tube**: one syn3A enzyme and its substrate. Michaelis–Menten curves emerge and match theory; crowding sliders show the slowdown. | done |
| 2 | **Glycolysis box**: the pathway from glucose to lactate making ATP, with a channelling demo (clustered vs spread enzymes). | done |
| 3 | **Central dogma**: transcription and translation with stochastic bursts in live copy numbers. | next |
| 4 | **Whole cell**: grows its membrane, copies its DNA and divides at least once. | planned |

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
    cell spends ATP on, until milestones 3 and 4 spend it for real.
17. **The channelling loss is a free parameter.** 1,3-BPG's real competing
    fates are slow; the loss rate is a knob that sets how far it travels,
    and the clustered enzymes are held still as a scaffold would hold them.

## Data sources

- Protein copy numbers: Breuer et al. 2019, *eLife* 8:e36842 (proteomics,
  77,028 proteins per average cell).
- mRNA counts, kinetic parameters and concentrations: the Luthey-Schulten lab
  [Minimal_Cell](https://github.com/Luthey-Schulten-Lab/Minimal_Cell)
  repository (CME_ODE/model_data), from Thornburg et al. 2022, *Cell*
  185:345. `tools/check_syn3a.py` checks every kcat, Km and mRNA count in
  `src/data/syn3a.js` against those files.
- Ribosomes (503), RNA polymerases (187), cell radius (200 nm), mRNA
  half-life (~2 min): Thornburg et al. 2022. Transcription 25 nt/s:
  Thornburg et al. 2019.
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
