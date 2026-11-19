"""Verdict rule B: verdict from CONDITIONAL net (radar-3 thresholds) AND
p(launch) >= break-even odds. Rows with a big conditional payoff but odds
below break-even are demoted to Skip (negative EV) with the reason shown.
Compare with rule A (expected-net thresholds, used in board_preview).
"""
import json, math, sys
sys.path.insert(0, 'research')
from validate import (ValueModel, comp_pools, census, dated_rows,
                      fit_odds, launch_p, screen_reason, PS, snap as snapj)

p128, _ = comp_pools()
model = ValueModel(p128)
odds = fit_odds(dated_rows())
cen, ranked0 = census()
watch = set(snapj['watchlist'])
screened_wl = [p for p in PS if p['slug'] in watch and screen_reason(p) is not None]
rankable = ranked0 + screened_wl

rows = []
for p in rankable:
    cond = max(1, round(math.exp(model.predict(p, 'blend'))))
    pr = launch_p(odds, p)
    ev = max(1, round(cond * pr))
    capital = max(50, min(p['tvl_usd'] * 0.1, 250))
    farmers = max(100, min(p['tvl_usd'] / 10000, 100000))
    fv = cond * 0.05 / farmers
    tbill = 0.04 * capital * 56 / 365
    net_cond = fv - 15 - tbill
    perh_cond = net_cond / 8
    be = (15 + tbill) / fv if fv > 0 else 1.0
    net_exp = fv * pr - 15 - tbill
    # rule B
    if net_cond >= 200 and perh_cond >= 25 and pr >= be:
        vB = 'Farm'
    elif net_cond >= 50 and perh_cond >= 10 and pr >= be:
        vB = 'Thin'
    else:
        vB = 'Skip'
    # rule A (expected net)
    perh_exp = net_exp / 8
    vA = 'Farm' if (net_exp >= 200 and perh_exp >= 25) else ('Thin' if (net_exp >= 50 and perh_exp >= 10) else 'Skip')
    rows.append({'slug': p['slug'], 'name': p['name'], 'cond': cond, 'p': pr, 'ev': ev,
                 'fv': fv, 'net_cond': net_cond, 'net_exp': net_exp, 'be': be,
                 'vA': vA, 'vB': vB, 'watch': p['slug'] in watch})

from collections import Counter
print('Rule A (expected-net thresholds):', dict(Counter(r['vA'] for r in rows)))
print('Rule B (conditional + p>=break-even):', dict(Counter(r['vB'] for r in rows)))
demoted = [r for r in rows if r['net_cond'] >= 50 and r['p'] < r['be']]
print(f"rows with conditional net >= $50 but odds below break-even (demoted by rule B): {len(demoted)}")
for r in sorted(demoted, key=lambda r: -r['net_cond'])[:10]:
    print(f"  {r['name'][:30]:30s} cond ${r['cond']/1e6:7.1f}M fv ${r['fv']:7.2f} "
          f"net_cond ${r['net_cond']:7.2f} p={r['p']:.3f} be={r['be']:.3f} net_exp ${r['net_exp']:7.2f}")
print()
print('Rule B Farm rows:')
for r in sorted([r for r in rows if r['vB'] == 'Farm'], key=lambda r: -r['ev']):
    print(f"  {r['name'][:30]:30s} cond ${r['cond']/1e6:7.1f}M p={r['p']:.3f} EV ${r['ev']/1e6:7.1f}M "
          f"fv ${r['fv']:7.2f} net_cond ${r['net_cond']:7.2f} net_exp ${r['net_exp']:7.2f} be={r['be']:.3f}"
          f"{' W' if r['watch'] else ''}")
print()
print('Top-10 EV rows under rule B:')
for r in sorted(rows, key=lambda r: (-r['ev'], r['slug']))[:10]:
    print(f"  {r['name'][:30]:30s} EV ${r['ev']/1e6:7.1f}M p={r['p']:.3f} "
          f"net_cond ${r['net_cond']:7.2f} net_exp ${r['net_exp']:7.2f} be={r['be']:.3f} -> {r['vB']}")
json.dump(rows, open('research/verdict-check.json', 'w'), indent=1)
