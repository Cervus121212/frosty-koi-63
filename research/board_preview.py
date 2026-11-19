"""Preview the radar-4 board: value model (r3 family, p128) + launch odds
+ EV ranking + local bands + farm math on EXPECTED value. Checks the EV
adoption criteria (3): 40/40 watchlist, top-10 odds >= 0.10, no zero odds.
"""
import json, math, sys
sys.path.insert(0, 'research')
from validate import (ValueModel, comp_pools, census, dated_rows,
                      fit_odds, launch_p, median, screen_reason, PS,
                      snap as snapj)

def percentile(v, q):
    if not v: return float('nan')
    v = sorted(v); k = (len(v) - 1) * q / 100.0
    f = int(k); c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)

p128, _ = comp_pools()
snap = snapj
model = ValueModel(p128)
odds = fit_odds(dated_rows())
cen, ranked0 = census()
watch = set(snap['watchlist'])
# watchlist is the floor: screened watchlist slugs are ranked anyway
screened_wl = [p for p in PS if p['slug'] in watch and screen_reason(p) is not None]
rankable = ranked0 + screened_wl
print(f"census: ranked {len(ranked0)} + watchlist-floor {len(screened_wl)} "
      f"({[p['slug'] for p in screened_wl]}) = {len(rankable)}")

# LOO errors for local bands (blend leg, p128)
def loo_errors():
    errs, comps = [], []
    for i in range(len(p128)):
        train = [p for j, p in enumerate(p128) if j != i]
        m = ValueModel(train)
        comps.append(p128[i])
        errs.append(math.log(p128[i]['mcap_usd']) - m.predict(p128[i], 'blend'))
    return comps, errs

comps, loo = loo_errors()
# local band: comps within +-1.0 lnTVL of the row
def local_band(tvl):
    lt = math.log(tvl)
    rs = [math.exp(e) for c, e in zip(comps, loo) if abs(math.log(c['tvl_usd']) - lt) <= 1.0]
    if len(rs) < 10:
        rs = [math.exp(e) for e in loo]
    rs.sort()
    return percentile(rs, 25), percentile(rs, 75), len(rs)

def farm(implied, tvl):
    capital = max(50, min(tvl * 0.1, 250))
    farmers = max(100, min(tvl / 10000, 100000))
    farmer_value = implied * 0.05 / farmers
    return capital, farmers, farmer_value

rows = []
for p in rankable:
    cond = max(1, round(math.exp(model.predict(p, 'blend'))))
    pr = launch_p(odds, p)
    ev = max(1, round(cond * pr))
    lo, hi, n = local_band(p['tvl_usd'])
    capital, farmers, fv = farm(cond, p['tvl_usd'])
    exp_fv = fv * pr
    tbill = 0.04 * capital * 56 / 365
    net = exp_fv - 15 - tbill
    perh = net / 8
    be = (15 + tbill) / fv if fv > 0 else 1.0
    verdict = 'Farm' if (net >= 200 and perh >= 25) else ('Thin' if (net >= 50 and perh >= 10) else 'Skip')
    rows.append({'slug': p['slug'], 'name': p['name'], 'cat': p['category'],
                 'tvl': p['tvl_usd'], 'cond': cond, 'p': round(pr, 4), 'ev': ev,
                 'band_lo': round(lo, 3), 'band_hi': round(hi, 3), 'band_n': n,
                 'capital': round(capital, 2), 'farmers': int(farmers),
                 'fv': round(fv, 2), 'exp_fv': round(exp_fv, 2),
                 'net': round(net, 2), 'perh': round(perh, 2), 'be': round(be, 4),
                 'verdict': verdict, 'watch': p['slug'] in watch})

rows.sort(key=lambda r: (-r['ev'], r['slug']))
# non-increasing EV enforcement after rounding
prev = float('inf')
for i, r in enumerate(rows):
    r['ev'] = min(r['ev'], prev); prev = r['ev']; r['rank'] = i + 1

print(f"board rows: {len(rows)} (rankable {len(rankable)})")
print(f"watchlist ranked: {sum(1 for r in rows if r['watch'])}/40")
print(f"verdicts: Farm {sum(1 for r in rows if r['verdict']=='Farm')}, "
      f"Thin {sum(1 for r in rows if r['verdict']=='Thin')}, "
      f"Skip {sum(1 for r in rows if r['verdict']=='Skip')}")
print(f"odds: min {min(r['p'] for r in rows):.4f} max {max(r['p'] for r in rows):.4f} "
      f"zero {sum(1 for r in rows if r['p']<=0)}")
print(f"top-10 odds: {[r['p'] for r in rows[:10]]}")
print(f"EV range top: {rows[0]['ev']:,} bottom: {rows[-1]['ev']:,}")
print()
print('TOP 15 by EV:')
for r in rows[:15]:
    print(f"  #{r['rank']:3d} {r['name'][:28]:28s} {r['cat'][:18]:18s} TVL ${r['tvl']/1e6:8.1f}M "
          f"cond ${r['cond']/1e6:8.1f}M p={r['p']:.3f} EV ${r['ev']/1e6:8.1f}M "
          f"band x{r['band_lo']:.2f}-x{r['band_hi']:.2f} net ${r['net']:7.2f} {r['verdict']}"
          f"{' W' if r['watch'] else ''}")
print()
print('WATCHLIST rows (40):')
for r in rows:
    if r['watch']:
        print(f"  #{r['rank']:3d} {r['name'][:28]:28s} cond ${r['cond']/1e6:7.1f}M p={r['p']:.3f} "
              f"EV ${r['ev']/1e6:7.1f}M net ${r['net']:7.2f} {r['verdict']}")
print()
print('TOP 10 by CONDITIONAL (radar-3 style, for comparison):')
for r in sorted(rows, key=lambda r: (-r['cond'], r['slug']))[:10]:
    print(f"  {r['name'][:28]:28s} cond ${r['cond']/1e6:8.1f}M p={r['p']:.3f} EV ${r['ev']/1e6:8.1f}M "
          f"EV-rank #{r['rank']}")
json.dump(rows, open('research/board-preview.json', 'w'), indent=1)
