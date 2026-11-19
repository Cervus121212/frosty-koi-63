"""Cross-pool check: does training on the ratio-banded pool (p109) generalise
to the FULL comp universe (p128), or does it only look better because its
own test set is easier? Train rule applied to TRAIN folds only; test on the
other universe's folds. Same CV protocol (5-fold x 5 seeds), blend 0.8 leg.
"""
import json, math, random, sys
sys.path.insert(0, 'research')
from validate import ValueModel, comp_pools, err_of, median, PS

p128, p109 = comp_pools()
s109 = {p['slug'] for p in p109}

def cv_cross(train_pool_fn, test_pool, label):
    errs = []
    for seed in range(5):
        idx = list(range(len(test_pool)))
        random.Random(1000 + seed).shuffle(idx)
        folds = [idx[i::5] for i in range(5)]
        for f in range(5):
            test_i = set(folds[f])
            train_all = [test_pool[i] for i in idx if i not in test_i]
            train = train_pool_fn(train_all)
            test = [test_pool[i] for i in folds[f]]
            m = ValueModel(train)
            errs.append(median(err_of(m, test, 'blend')))
    print(f'{label}: CV blend = {sum(errs)/len(errs):.4f} (n={len(errs)} folds)')
    return sum(errs) / len(errs)

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

def identity(train):
    return train

print('--- cross-pool CV (blend 0.8) ---')
cv_cross(identity, p128, 'train p128 -> test p128 (reference)')
cv_cross(banded, p128, 'train p109-rule -> test p128')
cv_cross(identity, p109, 'train p109 -> test p109 (reference)')
cv_cross(lambda t: t, p109, 'train p109 -> test p109 (same as reference)')
