"""Full suite, train = ratio-banded + deduped pool, test = FULL p128 universe.
The make() wrapper applies the banding to every train set (folds, WF train,
blind train, LOO train, bootstrap samples); test sets stay full p128.
"""
import json, sys
sys.path.insert(0, 'research')
from validate import ValueModel, comp_pools, validate

p128, _ = comp_pools()

def banded(train):
    out = []
    for p in train:
        if p['mcap_usd'] and p['tvl_usd'] > 0:
            r = p['mcap_usd'] / p['tvl_usd']
            if 0.02 <= r <= 20:
                out.append(p)
    bytok = {}
    for p in out:
        k = p['gecko_id'] or p['symbol'] or p['slug']
        if k not in bytok or p['tvl_usd'] > bytok[k]['tvl_usd']:
            bytok[k] = p
    return sorted(bytok.values(), key=lambda p: p['slug'])

def make(train):
    return ValueModel(banded(train))

v = validate(p128, make, legs=('blend', 'grouped', 'curve', 'ridge'))
out = {k: {kk: vv for kk, vv in d.items() if kk != 'loo_errors'} for k, d in v.items()}
json.dump(out, open('research/validation-banded.json', 'w'), indent=1)
for k, d in v.items():
    print(f"{k:10s} CV {d['cv_mean']} (sd {d['cv_sd']}) WF70 {d['walk_forward_70_30']} WF60 {d['walk_forward_60_40']} blind {d['blind_seed999']} (mean5 {d['blind_mean5']}) LOO {d['loo_med_abs_log']} boot {d['bootstrap_oob_median']}")
