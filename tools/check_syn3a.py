"""Check src/data/syn3a.js against the published syn3A model files.

Usage: python3 tools/check_syn3a.py DATA_DIR

DATA_DIR holds files from the Luthey-Schulten lab Minimal_Cell repository
(https://github.com/Luthey-Schulten-Lab/Minimal_Cell, CME_ODE/model_data):
  Central_AA_Zane_Balanced_direction_fixed_nounqATP.tsv
  lipid_NoH2O_balanced_model.tsv
  mRNA_counts.csv

It compares every kcat and Km in REACTIONS with the balanced "Parameter"
table of those files ("substrate catalytic rate constant", "Michaelis
constant" rows) and the mRNA count of every single-locus gene with
mRNA_counts.csv, and exits non-zero on a mismatch above 1%. Reactions the
files only give placeholder values for (0.1 mM) are reported, not failed.
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def js_object(src, name):
    m = re.search(r"export const %s = (\{.*?\n\}|\[.*?\n\]);" % name, src, re.S)
    body = m.group(1)
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r"([{,]\s*)([A-Za-z_][\w]*)\s*:", r'\1"\2":', body)
    body = body.replace("'", '"')
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    return json.loads(body)


def main(data):
    src = (ROOT / "src/data/syn3a.js").read_text()
    reactions = js_object(src, "REACTIONS")
    genes = js_object(src, "GENES")
    km_tab, kcat_tab = {}, {}
    # The lipid file has the fitted values for lipid reactions; the central
    # file only has placeholders for them, so it is read second.
    for f in ["lipid_NoH2O_balanced_model.tsv", "Central_AA_Zane_Balanced_direction_fixed_nounqATP.tsv"]:
        for line in (data / f).read_text().splitlines():
            cols = line.split("\t")
            if len(cols) < 4:
                continue
            try:
                value = float(cols[3])
            except ValueError:
                continue
            if cols[0] == "Michaelis constant":
                km_tab.setdefault((cols[1], cols[2]), value)
            elif cols[0] == "substrate catalytic rate constant":
                kcat_tab.setdefault(cols[1], value)
    met = {"bpg": "13dpg", "pg3": "3pg", "pg2": "2pg"}
    bad = 0

    def report(label, ours, ref):
        nonlocal bad
        if ref is None:
            print(f"  ?  {label}: not in the files")
            return
        ok = abs(ours / ref - 1) < 0.01
        bad += not ok
        print(f"{'ok' if ok else 'BAD'}  {label}: {ours} vs {ref}")

    for rxn, r in reactions.items():
        rid = [k for k in kcat_tab if re.fullmatch(r"R_%s(_\w+)?" % re.escape(rxn), k)]
        report(f"kcat {rxn}", r["kcat"], kcat_tab[rid[0]] if rid else None)
        for sub, km in zip(r["subs"], r["Km"]):
            keys = [k for k in km_tab if re.fullmatch(r"R_%s(_\w+)?" % re.escape(rxn), k[0]) and k[1] == f"M_{met.get(sub, sub)}_c"]
            report(f"Km {rxn} {sub}", km, km_tab[keys[0]] if keys else None)
    counts = {row["LocusTag"]: float(row["Count"]) for row in csv.DictReader((data / "mRNA_counts.csv").open())}
    for g in genes:
        # Complexes sum the mRNAs of every locus they list ('0233' is short
        # for JCVISYN3A_0233). The ribosome row lists no loci; its 52
        # r-protein genes sum to 39.7 mRNAs per cell.
        tags = [l if l.startswith("JCVISYN3A_") else "JCVISYN3A_" + l for l in g["loci"]]
        if not all(t in counts for t in tags):
            continue
        ref = sum(counts[t] for t in tags)
        report(f"mRNA {g['id']}", g["mrna"], round(ref, 3))
    print("mismatches:", bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
