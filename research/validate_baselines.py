"""Full validation suite for the two baselines under THIS protocol (same
splits as the fitted family): starter flat TVL x 0.25 and the old
median-multiple (radar-2). Both are fixed rules — no fitting — so all legs
are cheap. Appends to research/validation-results.json under 'baselines'.
"""
import json, math, sys
sys.path.insert(0, 'research')
from validate import comp_pools, validate, median

p128, _ = comp_pools()

class Starter:
    def __init__(self, train): pass
    def predict(self, p, leg='blend'):
        return math.log(0.25 * p['tvl_usd'])

class OldMedian:
    """radar-2's actual model, re-implemented exactly: per-category median
    mcap/TVL (global fallback <3 comps) x growth multiplier (0.6 weight,
    clamped -50..100) x age multiplier (0.70 + 0.30*min(age,730)/730, 0.85
    if undated) x chain multiplier (2% per extra chain, max 5)."""
    def __init__(self, train):
        from collections import defaultdict
        by = defaultdict(list)
        for c in train:
            by[c['category'] or 'Unknown'].append(c['mcap_usd'] / c['tvl_usd'])
        self.cat = {k: median(v) for k, v in by.items() if len(v) >= 3}
        self.glob = median([c['mcap_usd'] / c['tvl_usd'] for c in train])
    def predict(self, p, leg='blend'):
        from validate import age_days, clamp
        m = self.cat.get(p['category'] or 'Unknown', self.glob)
        g = 1.0 + clamp(p['change_7d'] or 0, -50, 100) / 100.0 * 0.6
        a = age_days(p)
        age = 0.85 if a is None else 0.70 + 0.30 * min(a, 730) / 730.0
        ch = 1.0 + 0.02 * min(max(len(p['chains']) - 1, 0), 5)
        return math.log(p['tvl_usd'] * m * g * age * ch)

out = {}
for name, cls in [('starter flat TVL x 0.25', Starter),
                  ('old median-multiple (radar-2)', OldMedian)]:
    v = validate(p128, cls, legs=('blend',))
    d = v['blend']
    out[name] = {k: d[k] for k in ('cv_mean', 'cv_sd', 'walk_forward_70_30',
                                   'walk_forward_60_40', 'blind_seed999',
                                   'blind_mean5', 'loo_med_abs_log',
                                   'bootstrap_oob_median')}
    print(name, out[name])

res = json.load(open('research/validation-results.json'))
res['baselines'] = out
json.dump(res, open('research/validation-results.json', 'w'), indent=1)
print('wrote baselines into validation-results.json')
