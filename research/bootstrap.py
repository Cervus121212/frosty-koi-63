"""Bootstrap rank ranges for radar-4: 200 refits of the fitted model
(value fit on bootstrap-resampled comps + odds fit on bootstrap-resampled
dated rows), rebuild the board by expected value each time, record the
p5-p95 of each row's rank. Output: lib/rank-ranges.json {slug: [lo, hi]}.

Same fits as research/validate.py (ValueModel + fit_odds/launch_p) and the
same board rules as lib/model.ts (watchlist floor, farm rule B does not
affect ranks). Deterministic: seed 20261119, one RNG stream.
"""
import json, math, random, sys
sys.path.insert(0, 'research')
from validate import (ValueModel, comp_pools, census, dated_rows, fit_odds,
                      launch_p, screen_reason, PS, snap as snapj)

p128, _ = comp_pools()
cen, ranked0 = census()
watch = set(snapj['watchlist'])
screened_wl = [p for p in PS if p['slug'] in watch and screen_reason(p) is not None]
RANKABLE = ranked0 + screened_wl
DATED = dated_rows()
NREP = 200
rng = random.Random(20261119)

def board_ranks(value_model, odds_model):
    rows = []
    for p in RANKABLE:
        cond = max(1, round(math.exp(value_model.predict(p, 'blend'))))
        pr = launch_p(odds_model, p)
        rows.append((max(1, round(cond * pr)), p['slug']))
    rows.sort(key=lambda t: (-t[0], t[1]))
    prev = float('inf')
    out = {}
    for i, (ev, slug) in enumerate(rows):
        ev = min(ev, prev)
        prev = ev
        out[slug] = i + 1
    return out

ranks = {p['slug']: [] for p in RANKABLE}
for rep in range(NREP):
    comps_b = [p128[rng.randrange(len(p128))] for _ in range(len(p128))]
    dated_b = [DATED[rng.randrange(len(DATED))] for _ in range(len(DATED))]
    vm = ValueModel(comps_b)
    om = fit_odds(dated_b)
    for slug, rk in board_ranks(vm, om).items():
        ranks[slug].append(rk)
    if (rep + 1) % 50 == 0:
        print(f'rep {rep + 1}/{NREP} done', flush=True)

def pct(v, q):
    v = sorted(v)
    k = (len(v) - 1) * q / 100.0
    f = int(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)

out = {}
for slug, rs in ranks.items():
    lo = max(1, int(round(pct(rs, 5))))
    hi = min(len(RANKABLE), int(round(pct(rs, 95))))
    out[slug] = [lo, hi]

json.dump(out, open('lib/rank-ranges.json', 'w'), indent=0)
# stability summary for the report
top = sorted(RANKABLE, key=lambda p: 0)  # placeholder, ranks from last rep not used
widths = [hi - lo for lo, hi in out.values()]
print(f'wrote lib/rank-ranges.json ({len(out)} slugs)')
print(f'band width: median {sorted(widths)[len(widths)//2]}, p90 {sorted(widths)[int(len(widths)*0.9)]}, max {max(widths)}')
for slug in ['steakhouse-financial', 'sentora-curator', 'gauntlet', 'usdd', 'polymarket-international']:
    print(f'  {slug}: {out[slug]}')
