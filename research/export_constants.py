"""Export every fitted constant the TS needs, from the same Python fit that
produced the preview board. Single source of truth: research/constants.json.
"""
import json, math, sys
sys.path.insert(0, 'research')
from validate import (ValueModel, comp_pools, census, dated_rows, fit_odds,
                      launch_p, screen_reason, PS, snap as snapj)

p128, _ = comp_pools()
m = ValueModel(p128)
odds = fit_odds(dated_rows())

# LOO errors (blend leg) for local bands
loo = []
for i in range(len(p128)):
    train = [p for j, p in enumerate(p128) if j != i]
    mm = ValueModel(train)
    loo.append({'ln_tvl': math.log(p128[i]['tvl_usd']),
                'err': math.log(p128[i]['mcap_usd']) - mm.predict(p128[i], 'blend')})

cen, ranked0 = census()
watch = set(snapj['watchlist'])
screened_wl = [p for p in PS if p['slug'] in watch and screen_reason(p) is not None]

out = {
  'value': {
    'curve_a': m.beta[0], 'curve_s': m.beta[1],
    'global_median_resid': m.global_med,
    'group_offsets': dict(m.offsets),
    'group_sizes': {g: len([c for c in p128 if __import__('validate').group_of(c['category']) == g])
                    for g in m.offsets},
    'ridge_chains': m.chains_top,
    'ridge_mean': m.mean, 'ridge_sd': m.sd, 'ridge_beta': m.beta_r,
    'shrink_k': 5, 'blend_grouped': 0.8, 'blend_ridge': 0.2,
    'ridge_lambda': 10.0, 'ridge_rounds': 40,
    'n_comps': len(p128),
  },
  'odds': {
    'edges': odds['edges'], 'hazards': odds['hazards'],
    'cat_mults': dict(odds['mults']),
    'floor': 0.05, 'cap': 5.0, 'undated_days': 365, 'horizon_years': 2,
    'n_dated': odds['n_dated'], 'n_token': odds['n_token'],
    'loglik': odds['loglik'], 'weibull': odds['weibull'],
  },
  'loo': loo,
  'census': {
    'total': len(PS), 'has_token': cen['has_token'], 'pre_token': cen['pre_token'],
    'exchange': cen['exchange'], 'bridge': cen['bridge'],
    'staking_product': cen['staking_product'], 'wrapped_btc': cen['wrapped_btc'],
    'wrapped_stablecoin': cen['wrapped_stablecoin'],
    'versioned_name': cen['versioned_name'], 'wrapped_name': cen['wrapped_name'],
    'ranked': len(ranked0) + len(screened_wl),
    'ranked_screened': len(ranked0), 'watchlist_floor': [p['slug'] for p in screened_wl],
    'watchlist_total': len(watch),
    'ranked_above_floor': cen['ranked_above_floor'],
    'ranked_below_floor': cen['ranked_below_floor'],
  },
  'validation': json.load(open('research/validation-results.json')),
}
json.dump(out, open('research/constants.json', 'w'), indent=1)
v = out['value']
print(f"curve a={v['curve_a']:.4f} s={v['curve_s']:.4f} global_med={v['global_median_resid']:.4f}")
print(f"ridge chains={v['ridge_chains']}")
print(f"ridge beta={[round(b,4) for b in v['ridge_beta']]}")
print(f"group offsets={ {k: round(x,4) for k,x in v['group_offsets'].items()} }")
print(f"hazards={[round(h,4) for h in out['odds']['hazards']]}")
print(f"cat mults={ {k: round(x,3) for k,x in out['odds']['cat_mults'].items()} }")
print(f"loo n={len(loo)}")
