// JCVI-syn3A data used by Flatcell.
//
// Copy numbers: Breuer et al. 2019 eLife (proteomics, 77,028 proteins per
// average cell), as distributed in the Luthey-Schulten lab Minimal_Cell
// repository (CME_ODE/model_data/proteomics.xlsx). Average mRNA counts per
// cell from the same repository (mRNA_counts.csv). Gene coordinates and
// lengths from syn3A.gb (GenBank CP016816). Forward kcat and Km values from
// the kinetic parameter tables of Thornburg et al. 2022 Cell
// (Central_AA_..._nounqATP.tsv, lipid_NoH2O_balanced_model.tsv).
// tools/check_syn3a.py checks every kcat, Km and mRNA count against them.

export const CELL = {
  radiusNm: 200,            // Thornburg et al. 2022
  totalProteins: 77028,     // Breuer et al. 2019
  ribosomes: 503,           // cryo-ET, Thornburg et al. 2022
  rnap: 187,                // Thornburg et al. 2019, 2022
  degradosomes: 120,        // Thornburg et al. 2022
  totalMRNA: 139,           // sum of mRNA_counts.csv
  genomeBp: 543379,         // syn3A.gb
  doublingMin: 105,         // measured in rich medium (Breuer et al. 2019)
  mRNAHalfLifeMin: 2,       // Thornburg et al. 2022 (spatial model 1.97 min)
};

export const PROCESS_RATES = {
  transcriptionNtPerS: 25,  // Thornburg et al. 2019
  translationAaPerS: 12,    // bacterial range 10-20 aa/s; see README
  forkBpPerS: 75,           // gives ~60 min to copy 543 kbp with 2 forks
};

// Typical concentrations (mM) from the Thornburg et al. 2022 parameter tables.
export const METABOLITES = {
  glc_e: { label: 'Glucose (medium)', mM: 0.1 },
  g6p: { label: 'Glucose 6-phosphate', mM: 3.71 },
  f6p: { label: 'Fructose 6-phosphate', mM: 0.854 },
  fdp: { label: 'Fructose 1,6-bisphosphate', mM: 7.60 },
  dhap: { label: 'Dihydroxyacetone phosphate', mM: 0.645 },
  g3p: { label: 'Glyceraldehyde 3-phosphate', mM: 0.1 },
  bpg: { label: '1,3-Bisphosphoglycerate', mM: 0.0098 },
  pg3: { label: '3-Phosphoglycerate', mM: 1.10 },
  pg2: { label: '2-Phosphoglycerate', mM: 0.0272 },
  pep: { label: 'Phosphoenolpyruvate', mM: 0.0409 },
  pyr: { label: 'Pyruvate', mM: 3.37 },
  lac: { label: 'Lactate', mM: 0.1 },
  atp: { label: 'ATP', mM: 3.65 },
  adp: { label: 'ADP', mM: 0.218 },
  nad: { label: 'NAD+', mM: 2.18 },
  nadh: { label: 'NADH', mM: 0.0253 },
  glyc: { label: 'Glycerol', mM: 0.956 },
  glyc3p: { label: 'Glycerol 3-phosphate', mM: 1.0 },
  fa: { label: 'Fatty acid', mM: 6.01 },
  ap: { label: 'Acyl phosphate', mM: 0.1 },
};

// Forward kinetic constants (Thornburg et al. 2022). Substrates are listed in
// the order they bind in our ordered-sequential mechanism; Km in mM.
export const REACTIONS = {
  PGI:  { subs: ['g6p'], prods: ['f6p'], kcat: 804.3, Km: [22.94] },
  PFK:  { subs: ['atp', 'f6p'], prods: ['adp', 'fdp'], kcat: 111.0, Km: [0.0255, 0.2133] },
  FBA:  { subs: ['fdp'], prods: ['dhap', 'g3p'], kcat: 59.7, Km: [0.2447] },
  TPI:  { subs: ['dhap'], prods: ['g3p'], kcat: 759.6, Km: [1.035] },
  GAPD: { subs: ['nad', 'g3p'], prods: ['nadh', 'bpg'], kcat: 119.6, Km: [5.697, 0.0171] },
  PGK:  { subs: ['adp', 'bpg'], prods: ['atp', 'pg3'], kcat: 220.0, Km: [0.5273, 0.0014] },
  PGM:  { subs: ['pg3'], prods: ['pg2'], kcat: 434.0, Km: [1.887] },
  ENO:  { subs: ['pg2'], prods: ['pep'], kcat: 62.18, Km: [0.246] },
  PYK:  { subs: ['adp', 'pep'], prods: ['atp', 'pyr'], kcat: 3204, Km: [0.2814, 0.0754] },
  LDH:  { subs: ['nadh', 'pyr'], prods: ['nad', 'lac'], kcat: 388.5, Km: [0.0381, 0.9649] },
  // PTS: glucose from the medium plus PEP gives G6P and pyruvate.
  GLCpts: { subs: ['pep'], prods: ['g6p', 'pyr'], kcat: 3122, Km: [0.1], external: { glc_e: 0.1 } },
  GLYK: { subs: ['atp', 'glyc'], prods: ['adp', 'glyc3p'], kcat: 3280, Km: [0.3337, 0.1345] },
  FAK:  { subs: ['atp', 'fa'], prods: ['adp', 'ap'], kcat: 74.88, Km: [1.453, 0.3014] },
  // PlsY then PlsC; lumped as one step to phosphatidic acid ("lipid").
  APG3PAT: { subs: ['ap', 'glyc3p'], prods: ['lipid'], kcat: 8.499, Km: [0.0206, 0.0206] },
};

// The reduced gene set. Each row is one particle type in the model. Rows that
// stand for a complex list every locus they lump together; `copies` is the
// measured copy number of the complex (or of its best-measured subunit).
// `aa` is the total length the ribosome must translate to make one.
// `rate` is the row's characteristic rate with its unit.
export const GENES = [
  // Uptake
  { id: 'ptsG', loci: ['JCVISYN3A_0779', '0233', '0694', '0234'], start: 460467, name: 'PtsG', product: 'PTS glucose transporter (EIICB, with EI, HPr, EIIA)', role: 'uptake', aa: 1561, copies: 831, mrna: 1.287, rxn: 'GLCpts', membrane: true, rate: '3122 /s (kcat)' },
  { id: 'opp', loci: ['JCVISYN3A_0169', '0165', '0167', '0168'], start: 114778, name: 'Opp', product: 'Oligopeptide ABC importer (amino acid supply)', role: 'uptake', aa: 2635, copies: 314, mrna: 0.518, membrane: true, rate: '~20 aa/s per complex (ATP-driven)' },
  { id: 'rns', loci: ['JCVISYN3A_0010', '0008', '0009', '0011'], start: 13525, name: 'Rns', product: 'Nucleoside ABC importer (NTP supply)', role: 'uptake', aa: 2266, copies: 145, mrna: 0.223, membrane: true, rate: '~20 nt/s per complex (ATP-driven)' },
  // Glycolysis
  { id: 'pgi', loci: ['JCVISYN3A_0445'], start: 297882, name: 'Pgi', product: 'Glucose-6-phosphate isomerase', role: 'glycolysis', aa: 427, copies: 266, mrna: 0.44, rxn: 'PGI', rate: '804 /s (kcat)' },
  { id: 'pfkA', loci: ['JCVISYN3A_0220'], start: 133142, name: 'PfkA', product: '6-Phosphofructokinase', role: 'glycolysis', aa: 326, copies: 458, mrna: 0.741, rxn: 'PFK', rate: '111 /s (kcat)' },
  { id: 'fbaA', loci: ['JCVISYN3A_0131'], start: 83504, name: 'FbaA', product: 'Fructose-bisphosphate aldolase', role: 'glycolysis', aa: 297, copies: 227, mrna: 0.347, rxn: 'FBA', rate: '59.7 /s (kcat)' },
  { id: 'tpiA', loci: ['JCVISYN3A_0727'], start: 445270, name: 'TpiA', product: 'Triose-phosphate isomerase', role: 'glycolysis', aa: 248, copies: 410, mrna: 0.661, rxn: 'TPI', rate: '760 /s (kcat)' },
  { id: 'gapDH', loci: ['JCVISYN3A_0607'], start: 372272, name: 'GapDH', product: 'Glyceraldehyde-3-phosphate dehydrogenase', role: 'glycolysis', aa: 338, copies: 1355, mrna: 2.178, rxn: 'GAPD', rate: '120 /s (kcat)' },
  { id: 'pgk', loci: ['JCVISYN3A_0606'], start: 370946, name: 'Pgk', product: 'Phosphoglycerate kinase', role: 'glycolysis', aa: 404, copies: 411, mrna: 0.656, rxn: 'PGK', rate: '220 /s (kcat)' },
  { id: 'pgm', loci: ['JCVISYN3A_0729'], start: 446848, name: 'Pgm', product: 'Phosphoglycerate mutase', role: 'glycolysis', aa: 531, copies: 322, mrna: 0.519, rxn: 'PGM', rate: '434 /s (kcat)' },
  { id: 'eno', loci: ['JCVISYN3A_0213'], start: 127920, name: 'Eno', product: 'Enolase', role: 'glycolysis', aa: 451, copies: 998, mrna: 1.678, rxn: 'ENO', rate: '62.2 /s (kcat)' },
  { id: 'pyk', loci: ['JCVISYN3A_0221'], start: 134193, name: 'Pyk', product: 'Pyruvate kinase', role: 'glycolysis', aa: 478, copies: 551, mrna: 0.957, rxn: 'PYK', rate: '3204 /s (kcat)' },
  { id: 'ldh', loci: ['JCVISYN3A_0475'], start: 307123, name: 'Ldh', product: 'L-lactate dehydrogenase', role: 'glycolysis', aa: 318, copies: 1100, mrna: 1.894, rxn: 'LDH', rate: '389 /s (kcat)' },
  // Lipids
  { id: 'glpK', loci: ['JCVISYN3A_0218'], start: 131274, name: 'GlpK', product: 'Glycerol kinase', role: 'lipids', aa: 505, copies: 396, mrna: 0.625, rxn: 'GLYK', rate: '3280 /s (kcat)' },
  { id: 'fak', loci: ['JCVISYN3A_0420', '0617'], start: 272174, name: 'FakAB', product: 'Fatty acid kinase (FakA with FakB)', role: 'lipids', aa: 830, copies: 205, mrna: 0.324, rxn: 'FAK', rate: '74.9 /s (kcat)' },
  { id: 'pls', loci: ['JCVISYN3A_0117', '0512'], start: 77446, name: 'PlsYC', product: 'Acyltransferases PlsY and PlsC (to phosphatidic acid)', role: 'lipids', aa: 568, copies: 170, mrna: 0.251, rxn: 'APG3PAT', membrane: true, rate: '8.5 /s (kcat)' },
  // Information processing
  { id: 'rnap', loci: ['JCVISYN3A_0804', '0803', '0645', '0407'], start: 479651, name: 'RNAP', product: 'RNA polymerase holoenzyme (beta, beta\', alpha2, sigma)', role: 'transcription', aa: 3686, copies: 187, mrna: 0.907, rate: '25 nt/s' },
  { id: 'ribosome', loci: ['rrnA/B operons', 'rpsB ... rpmJ (52 r-proteins)'], start: 52580, name: 'Ribosome', product: '70S ribosome (2 rRNA operons, 52 proteins)', role: 'translation', aa: 7400, copies: 503, mrna: 0.83, rate: '12 aa/s' },
  { id: 'rnj', loci: ['JCVISYN3A_0600', '0257'], start: 364772, name: 'RNase J', product: 'Degradosome (RNase J1/J2)', role: 'translation', aa: 1193, copies: 120, mrna: 0.173, rate: 'mRNA half-life 2 min' },
  { id: 'dnaA', loci: ['JCVISYN3A_0001'], start: 1, name: 'DnaA', product: 'Replication initiator', role: 'replication', aa: 450, copies: 148, mrna: 0.261, rate: 'binds oriC on contact' },
  { id: 'replisome', loci: ['JCVISYN3A_0303', '0002', '0834', '0406'], start: 183022, name: 'Replisome', product: 'PolC with DnaN clamp, DnaC helicase, DnaG primase', role: 'replication', aa: 2907, copies: 104, mrna: 0.123, rate: '75 bp/s per fork' },
  { id: 'ftsZ', loci: ['JCVISYN3A_0522'], start: 331411, name: 'FtsZ', product: 'Cell division GTPase (Z ring)', role: 'division', aa: 385, copies: 541, mrna: 0.853, rate: 'ring forms at midcell' },
];

// Expand short locus numbers ('0233') to full tags.
for (const g of GENES) g.loci = g.loci.map((l) => (/^\d{4}$/.test(l) ? 'JCVISYN3A_' + l : l));

export const MASS_PER_AA_KDA = 0.11;
