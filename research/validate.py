"""Token-radar radar-4 research: value-model validation, launch-odds fit,
census with explicit exclusions, ablation, and the expected-value decision.

All code here is written fresh for radar-4 (this session). The validation
protocol is the same as radar-3's so the numbers are comparable:
metric = median |ln(pred/mcap)|, lower is better.
  - 5-fold CV x 5 seeds (refit inside every fold: curve, group offsets,
    ridge leg, chain top-5 — no leakage)
  - walk-forward by listed_at: 70/30 and 60/40
  - blind 20% hold-out: seed 999, plus mean over seeds 999,1,2,3,4
  - leave-one-out
  - bootstrap 200 resamples, out-of-bag median
Launch odds (my own fit): piecewise-constant hazard in six age buckets,
current-status MLE by coordinate ascent, category multiplier shrunk toward 1
with 3 pseudo-observations, hazard floor 0.05/yr. Hold-out: seeded 70/30
split by djb2 slug hash + time split at median listed_at; scored on hit
rate at 0.5, Brier vs the train-base-rate Brier, and calibration by bucket.

Expected-value adoption rule (stated before seeing the numbers): adopt
ranking by expected value (conditional x launch odds) ONLY if
  (1) the value model is at least as good as radar-3's blend on CV, WF70,
      WF60 and LOO (within noise: CV +-0.01, WF/LOO no worse than +0.02),
  (2) the odds hold-out beats the constant base-rate predictor on Brier
      AND its hit rate beats the majority rate, and
  (3) the board stays sane: 40/40 watchlist, top-10 expected-value rows
      all have odds >= 0.10, no row gets odds exactly 0.
Otherwise keep ranking by conditional (implied) value and ship the other
features (proof file, local bands, census, break-even odds, what-if).
"""
import json
import math
import random
import re
from collections import Counter, defaultdict

SNAP = '/home/hatch/workspace/makefun/kit/token-radar-01-kit-r4/token-radar-01-kit/input/snapshot.json'
OUT = '/home/hatch/workspace/makefun/token-radar-01-radar4/research/validation-results.json'

snap = json.load(open(SNAP))
PS = snap['protocols']
AS_OF = snap['as_of']
FLOOR = snap['floor_usd']

# ---------------------------------------------------------------- utilities

def median(v):
    s = sorted(v)
    n = len(s)
    if n == 0:
        return 0.0
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def age_days(p):
    if not p['listed_at']:
        return None
    from datetime import date
    a = date.fromisoformat(AS_OF)
    b = date.fromisoformat(p['listed_at'])
    return max(0, (a - b).days)


def solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[piv] = M[piv], M[c]
        d = M[c][c]
        if abs(d) < 1e-12:
            raise ValueError('singular')
        for j in range(c, n + 1):
            M[c][j] /= d
        for r in range(n):
            if r == c:
                continue
            f = M[r][c]
            for j in range(c, n + 1):
                M[r][j] -= f * M[c][j]
    return [M[i][n] for i in range(n)]


def ols(X, y):
    k = len(X[0])
    ata = [[0.0] * k for _ in range(k)]
    atb = [0.0] * k
    for row, t in zip(X, y):
        for r in range(k):
            atb[r] += row[r] * t
            for c in range(k):
                ata[r][c] += row[r] * row[c]
    for r in range(k):
        ata[r][r] += 1e-9
    return solve(ata, atb)


# ---------------------------------------------------------------- census

VERSIONED = re.compile(r'\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$')
WRAPPED_WORD = re.compile(r'\b(wrapped|staked|staking)\b', re.I)

EXCL_CEX = {'CEX'}
EXCL_BRIDGE = {'Bridge', 'Canonical Bridge', 'Cross Chain Bridge'}
EXCL_STAKING = {'Liquid Staking', 'Liquid Restaking', 'Restaking', 'Restaked BTC', 'Staking Pool'}
EXCL_BTC_WRAP = {'Anchor BTC', 'Decentralized BTC'}
EXCL_STABLE_WRAP = {'Stablecoin Wrapper'}


def has_token(p):
    return p['mcap_usd'] is not None or p['gecko_id'] is not None or p['symbol'] is not None


def exchange_first_words():
    words = set()
    for p in PS:
        if p['category'] == 'CEX':
            w = re.split(r'[^A-Za-z]+', p['name'])[0].lower()
            if w:
                words.add(w)
    return words


EXCH = exchange_first_words()


def screen_reason(p):
    """First exclusion reason, in the order the census counts use."""
    if p['category'] in EXCL_CEX:
        return 'exchange'
    if p['category'] in EXCL_BRIDGE:
        return 'bridge'
    if p['category'] in EXCL_STAKING:
        return 'staking_product'
    if p['category'] in EXCL_BTC_WRAP:
        return 'wrapped_btc'
    if p['category'] in EXCL_STABLE_WRAP:
        return 'wrapped_stablecoin'
    if VERSIONED.search(p['name']):
        return 'versioned_name'
    if WRAPPED_WORD.search(p['name']):
        return 'wrapped_name'
    first = re.split(r'[^A-Za-z]+', p['name'])[0].lower()
    if first and first in EXCH:
        return 'exchange_name'
    return None


def census():
    c = Counter()
    ranked = []
    for p in PS:
        if has_token(p):
            c['has_token'] += 1
            continue
        c['pre_token'] += 1
        r = screen_reason(p)
        if r is None:
            ranked.append(p)
        else:
            c[r] += 1
    c['ranked'] = len(ranked)
    wl = set(snap['watchlist'])
    c['watchlist_total'] = len(wl)
    c['watchlist_ranked'] = sum(1 for p in ranked if p['slug'] in wl)
    c['watchlist_screened'] = [p['slug'] for p in PS if p['slug'] in wl and screen_reason(p) is not None]
    c['ranked_above_floor'] = sum(1 for p in ranked if p['tvl_usd'] >= FLOOR)
    c['ranked_below_floor'] = len(ranked) - c['ranked_above_floor']
    return c, ranked


# ---------------------------------------------------------------- value model

GROUP_POOL = {
    'Bridge': 'Bridge', 'Canonical Bridge': 'Bridge', 'Cross Chain Bridge': 'Bridge',
    'Liquid Staking': 'Staking', 'Liquid Restaking': 'Staking', 'Restaking': 'Staking',
    'Staking Pool': 'Staking',
    'Yield': 'Yield', 'Yield Aggregator': 'Yield', 'Leveraged Farming': 'Yield',
    'Lending': 'Lending', 'CDP': 'Lending', 'Collateral Management': 'Lending',
    'AI Agents': 'AI', 'Decentralized AI': 'AI',
    'Dexs': 'Dexs', 'Liquidity Manager': 'Dexs',
}


def group_of(cat):
    return GROUP_POOL.get(cat, cat) if cat else 'Unknown'


def top_chains(comps, k=5):
    cnt = Counter()
    for c in comps:
        for ch in c['chains']:
            cnt[ch] += 1
    return [ch for ch, _ in sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]


def ridge_feats(p, chains_top):
    growth = clamp(p['change_7d'] if p['change_7d'] is not None else 0, -50, 100) / 100.0
    age = age_days(p) or 365
    log_age = math.log(max(age, 1) + 1)
    flags = [1.0 if ch in p['chains'] else 0.0 for ch in chains_top]
    return [math.log(p['tvl_usd']), growth, log_age, float(len(p['chains']))] + flags


class ValueModel:
    """log-log curve (+optional ln(age)) + grouped shrunk medians + ridge-LAD."""

    def __init__(self, comps, use_age=False, shrink_k=5, blend=0.8, lam=10.0, rounds=40):
        self.use_age = use_age
        self.shrink_k = shrink_k
        self.blend = blend
        self.lam = lam
        self.rounds = rounds
        self.fit(comps)

    def _design(self, p):
        row = [1.0, math.log(p['tvl_usd'])]
        if self.use_age:
            age = age_days(p) or 365
            row.append(math.log(max(age, 1)))
        return row

    def fit(self, comps):
        self.comps = comps
        X = [self._design(c) for c in comps]
        y = [math.log(c['mcap_usd']) for c in comps]
        beta = ols(X, y)
        self.beta = beta
        resid = [t - sum(b * v for b, v in zip(beta, row)) for row, t in zip(X, y)]
        self.global_med = median(resid)
        by_g = defaultdict(list)
        for c, r in zip(comps, resid):
            by_g[group_of(c['category'])].append(r)
        self.offsets = {}
        for g, rs in by_g.items():
            w = len(rs) / (len(rs) + self.shrink_k)
            self.offsets[g] = w * median(rs) + (1 - w) * self.global_med
        # ridge-LAD leg
        self.chains_top = top_chains(comps, 5)
        F = [ridge_feats(c, self.chains_top) for c in comps]
        d = len(F[0])
        self.mean = [sum(r[j] for r in F) / len(F) for j in range(d)]
        self.sd = []
        for j in range(d):
            v = sum((r[j] - self.mean[j]) ** 2 for r in F) / len(F)
            self.sd.append(math.sqrt(v) or 1.0)
        Xs = [[1.0] + [(r[j] - self.mean[j]) / self.sd[j] for j in range(d)] for r in F]
        k = d + 1
        ata = [[sum(r[i] * r[j] for r in Xs) for j in range(k)] for i in range(k)]
        atb = [sum(r[i] * t for r, t in zip(Xs, y)) for i in range(k)]
        beta_r = solve(ata, atb)
        for _ in range(self.rounds):
            w = []
            for i in range(len(comps)):
                pr = sum(b * v for b, v in zip(beta_r, Xs[i]))
                w.append(1.0 / max(abs(y[i] - pr), 0.1))
            A = [[sum(wi * r[i] * r[j] for wi, r in zip(w, Xs)) for j in range(k)] for i in range(k)]
            for j in range(1, k):
                A[j][j] += self.lam
            rhs = [sum(wi * r[i] * t for wi, r, t in zip(w, Xs, y)) for i in range(k)]
            beta_r = solve(A, rhs)
        self.beta_r = beta_r

    def _curve(self, p):
        return sum(b * v for b, v in zip(self.beta, self._design(p)))

    def _grouped(self, p):
        return self._curve(p) + self.offsets.get(group_of(p['category']), self.global_med)

    def _ridge(self, p):
        f = ridge_feats(p, self.chains_top)
        xs = [1.0] + [(v - self.mean[j]) / self.sd[j] for j, v in enumerate(f)]
        return sum(b * v for b, v in zip(self.beta_r, xs))

    def predict(self, p, leg='blend'):
        if leg == 'curve':
            return self._curve(p)
        if leg == 'grouped':
            return self._grouped(p)
        if leg == 'ridge':
            return self._ridge(p)
        return self.blend * self._grouped(p) + (1 - self.blend) * self._ridge(p)


def comp_pools():
    p128 = [p for p in PS if p['mcap_usd'] and p['mcap_usd'] > 0 and p['tvl_usd'] > 0]
    inband = []
    for p in p128:
        r = p['mcap_usd'] / p['tvl_usd']
        if 0.02 <= r <= 20:
            inband.append(p)
    bytok = {}
    for p in inband:
        k = p['gecko_id'] or p['symbol'] or p['slug']
        if k not in bytok or p['tvl_usd'] > bytok[k]['tvl_usd']:
            bytok[k] = p
    p109 = sorted(bytok.values(), key=lambda p: p['slug'])
    return p128, p109


def err_of(model, comps, leg='blend'):
    return [abs(model.predict(c, leg) - math.log(c['mcap_usd'])) for c in comps]


def validate(comps, make, legs=('blend',)):
    """Full suite. make(comps) -> model. One fit per split; all legs are
    predictions from the same fitted model. Returns {leg: {...}}."""
    out = {leg: {'cv': [], 'wf70': None, 'wf60': None, 'blind': [], 'loo': [], 'boot': []} for leg in legs}
    dated = [c for c in comps if c['listed_at']]

    # CV 5-fold x 5 seeds: fit once per fold, score every leg
    cv_err = {leg: [] for leg in legs}
    for seed in range(5):
        idx = list(range(len(comps)))
        random.Random(1000 + seed).shuffle(idx)
        folds = [idx[i::5] for i in range(5)]
        for f in range(5):
            test_i = set(folds[f])
            train = [comps[i] for i in idx if i not in test_i]
            test = [comps[i] for i in folds[f]]
            m = make(train)
            for leg in legs:
                cv_err[leg].append(median(err_of(m, test, leg)))
    # walk-forward by listed_at
    srt = sorted(dated, key=lambda p: p['listed_at'])
    wf_err = {}
    for frac, name in ((0.7, 'wf70'), (0.6, 'wf60')):
        cut = int(len(srt) * frac)
        m = make(srt[:cut])
        for leg in legs:
            wf_err[(leg, name)] = median(err_of(m, srt[cut:], leg))
    # blind 20%
    blind_err = {leg: [] for leg in legs}
    for seed in [999, 1, 2, 3, 4]:
        idx = list(range(len(comps)))
        random.Random(seed).shuffle(idx)
        n_test = max(1, int(0.2 * len(comps)))
        test_i = set(idx[:n_test])
        train = [comps[i] for i in idx if i not in test_i]
        test = [comps[i] for i in idx[:n_test]]
        m = make(train)
        for leg in legs:
            blind_err[leg].append(median(err_of(m, test, leg)))
    # LOO: one fit per left-out comp, all legs
    loo_err = {leg: [] for leg in legs}
    for i in range(len(comps)):
        train = comps[:i] + comps[i + 1:]
        m = make(train)
        t = math.log(comps[i]['mcap_usd'])
        for leg in legs:
            loo_err[leg].append(abs(m.predict(comps[i], leg) - t))
    # bootstrap OOB x200
    boot_err = {leg: [] for leg in legs}
    rng = random.Random(20261119)
    for _ in range(200):
        samp = [comps[rng.randrange(len(comps))] for _ in range(len(comps))]
        ids = {id(x) for x in samp}
        oob = [c for c in comps if id(c) not in ids]
        if not oob:
            continue
        m = make(samp)
        for leg in legs:
            boot_err[leg].append(median(err_of(m, oob, leg)))
    res = {}
    for leg in legs:
        res[leg] = {
            'cv_mean': round(sum(cv_err[leg]) / len(cv_err[leg]), 4),
            'cv_sd': round((sum((v - sum(cv_err[leg]) / len(cv_err[leg])) ** 2 for v in cv_err[leg]) / len(cv_err[leg])) ** 0.5, 4),
            'walk_forward_70_30': round(wf_err[(leg, 'wf70')], 4),
            'walk_forward_60_40': round(wf_err[(leg, 'wf60')], 4),
            'blind_seed999': round(blind_err[leg][0], 4),
            'blind_mean5': round(sum(blind_err[leg]) / len(blind_err[leg]), 4),
            'loo_med_abs_log': round(median(loo_err[leg]), 4),
            'bootstrap_oob_median': round(median(boot_err[leg]), 4),
            'loo_errors': loo_err[leg],
        }
    return res


def cv_only(comps, make, legs=('blend',)):
    """5-fold CV x 5 seeds only (for sensitivity scans)."""
    cv_err = {leg: [] for leg in legs}
    for seed in range(5):
        idx = list(range(len(comps)))
        random.Random(1000 + seed).shuffle(idx)
        folds = [idx[i::5] for i in range(5)]
        for f in range(5):
            test_i = set(folds[f])
            train = [comps[i] for i in idx if i not in test_i]
            test = [comps[i] for i in folds[f]]
            m = make(train)
            for leg in legs:
                cv_err[leg].append(median(err_of(m, test, leg)))
    return {leg: {'cv_mean': round(sum(v) / len(v), 4)} for leg, v in cv_err.items()}


# ---------------------------------------------------------------- launch odds

YEAR = 365.25
ODDS_EDGES = [0, 0.5, 1, 2, 3, 5, float('inf')]
ODDS_FLOOR = 0.05
ODDS_CAP = 5.0
ODDS_SHRINK = 3
UNKNOWN_AGE_DAYS = 365


def djb2(s):
    h = 5381
    for ch in s:
        h = ((h * 33) + ord(ch)) & 0xFFFFFFFF
    return h / 4294967296.0


def dated_rows():
    rows = []
    for p in PS:
        if not p['listed_at']:
            continue
        age = (age_days(p) or 0) / YEAR
        rows.append({'p': p, 'ageY': age, 'token': has_token(p)})
    return rows


def cum_haz(ageY, hazards, edges=ODDS_EDGES):
    h = 0.0
    for j in range(len(hazards)):
        h += hazards[j] * max(0.0, min(ageY, edges[j + 1]) - edges[j])
    return h


def _loglik(rows, hazards):
    ll = 0.0
    for r in rows:
        h = cum_haz(r['ageY'], hazards)
        ll += math.log(max(1 - math.exp(-h), 1e-12)) if r['token'] else -h
    return ll


def fit_hazards(rows, start=0.3):
    hazards = [start] * (len(ODDS_EDGES) - 1)
    ll = _loglik(rows, hazards)
    for _ in range(400):
        improved = False
        for j in range(len(hazards)):
            for f in (1.25, 1.1, 1.05, 0.95, 0.9, 0.8):
                trial = hazards[:]
                trial[j] = max(ODDS_FLOOR, min(ODDS_CAP, trial[j] * f))
                v = _loglik(rows, trial)
                if v > ll + 1e-9:
                    hazards, ll, improved = trial, v, True
        if not improved:
            break
    return hazards, ll


def cat_mults(rows, hazards):
    by = defaultdict(list)
    for r in rows:
        by[r['p']['category'] or '__null'].append(r)
    out = {}
    for cat, rs in by.items():
        ev = sum(1 - math.exp(-cum_haz(r['ageY'], hazards)) for r in rs)
        events = sum(1 for r in rs if r['token'])
        out[cat] = (events + ODDS_SHRINK) / (ev + ODDS_SHRINK)
    return out


def fit_weibull(rows):
    best = {'k': 1.0, 'theta': 1.0, 'loglik': -1e18}
    k = 0.3
    while k <= 3.001:
        th = 0.5
        while th <= 10.001:
            ll = 0.0
            for r in rows:
                h = (r['ageY'] / th) ** k
                ll += math.log(max(1 - math.exp(-h), 1e-12)) if r['token'] else -h
            if ll > best['loglik']:
                best = {'k': round(k, 2), 'theta': round(th, 1), 'loglik': round(ll, 2)}
            th += 0.2
        k += 0.1
    return best


def launch_p(model, p):
    age = (age_days(p) or UNKNOWN_AGE_DAYS) / YEAR
    m = model['mults'].get(p['category'] or '__null', 1.0)
    mass = cum_haz(age + 2, model['hazards']) - cum_haz(age, model['hazards'])
    return 1 - math.exp(-m * mass)


def fit_odds(rows):
    hazards, ll = fit_hazards(rows)
    return {
        'hazards': [round(h, 4) for h in hazards],
        'edges': ODDS_EDGES[:-1],
        'mults': {k: round(v, 4) for k, v in cat_mults(rows, hazards).items()},
        'loglik': round(ll, 2),
        'n_dated': len(rows),
        'n_token': sum(1 for r in rows if r['token']),
        'weibull': fit_weibull(rows),
        '_haz': hazards,
        '_mults': cat_mults(rows, hazards),
    }


def score_holdout(train, test, cut=None):
    hazards, _ = fit_hazards(train)
    mults = cat_mults(train, hazards)
    train_base = sum(1 for r in train if r['token']) / max(len(train), 1)
    hit = brier = base_brier = mean_pred = 0.0
    for r in test:
        m = mults.get(r['p']['category'] or '__null', 1.0)
        pr = min(0.999, max(0.001, 1 - math.exp(-m * cum_haz(r['ageY'], hazards))))
        hit += 1 if (pr >= 0.5) == r['token'] else 0
        brier += (pr - (1 if r['token'] else 0)) ** 2
        base_brier += (train_base - (1 if r['token'] else 0)) ** 2
        mean_pred += pr
    n = len(test)
    obs = sum(1 for r in test if r['token']) / max(n, 1)
    cal = []
    for lo, hi in [(0, 0.5), (0.5, 1), (1, 2), (2, 3), (3, 5), (5, 99)]:
        inb = [r for r in test if lo <= r['ageY'] < hi]
        if not inb:
            cal.append({'lo': lo, 'hi': hi, 'n': 0, 'predicted': 0, 'observed': 0})
            continue
        prs = []
        for r in inb:
            mm = mults.get(r['p']['category'] or '__null', 1.0)
            prs.append(min(0.999, max(0.001, 1 - math.exp(-mm * cum_haz(r['ageY'], hazards)))))
        pr = sum(prs) / len(inb)
        cal.append({'lo': lo, 'hi': hi, 'n': len(inb),
                    'predicted': round(pr, 4),
                    'observed': round(sum(1 for r in inb if r['token']) / len(inb), 4)})
    out = {'n_train': len(train), 'n_test': n,
           'base_rate': round(obs, 4),
           'majority_rate': round(max(obs, 1 - obs), 4),
           'hit_rate': round(hit / n, 4) if n else 0,
           'brier': round(brier / n, 4) if n else 0,
           'base_brier': round(base_brier / n, 4) if n else 0,
           'mean_predicted': round(mean_pred / n, 4) if n else 0,
           'observed': round(obs, 4),
           'calibration': cal}
    if cut:
        out['cut'] = cut
    return out


def evaluate_odds():
    rows = dated_rows()
    test = [r for r in rows if djb2(r['p']['slug']) < 0.3]
    train = [r for r in rows if djb2(r['p']['slug']) >= 0.3]
    srt = sorted(rows, key=lambda r: r['p']['listed_at'])
    cut = srt[len(srt) // 2]['p']['listed_at']
    t_train = [r for r in rows if r['p']['listed_at'] <= cut]
    t_test = [r for r in rows if r['p']['listed_at'] > cut]
    return {
        'random': score_holdout(train, test),
        'time': score_holdout(t_train, t_test, cut),
        'model': fit_odds(rows),
    }


# ---------------------------------------------------------------- main

def main():
    res = {'metric': 'median |ln(pred/mcap)|, lower is better'}
    # census
    c, ranked = census()
    res['census'] = dict(c)
    print('CENSUS:', dict(c))
    wl_screened = c['watchlist_screened']
    print('watchlist screened (must be []):', wl_screened)

    p128, p109 = comp_pools()
    res['comps'] = len(p128)
    res['comps_banded'] = len(p109)
    print('comps p128:', len(p128), '| p109:', len(p109))

    # value-model variants
    def mk_r3(train, use_age=False, shrink_k=5, blend=0.8):
        return ValueModel(train, use_age=use_age, shrink_k=shrink_k, blend=blend)

    variants = {}
    print('--- validating variants (this takes a while) ---')
    # baseline starter + median multiple (cheap, no refit)
    def med_err(comps, fn):
        return [abs(math.log(fn(c)) - math.log(c['mcap_usd'])) for c in comps]
    starter = median([math.log(c['mcap_usd'] / c['tvl_usd']) for c in p128])
    variants['starter flat x0.25'] = {'cv_mean': round(median([abs(math.log(c['tvl_usd'] * 0.25) - math.log(c['mcap_usd'])) for c in p128]), 4)}
    variants['global median multiple'] = {'cv_mean': round(median([abs(math.log(c['tvl_usd'] * math.exp(starter)) - math.log(c['mcap_usd'])) for c in p128]), 4)}

    v = validate(p128, lambda t: mk_r3(t), legs=('blend', 'grouped', 'curve', 'ridge'))
    variants['r3-family p128 blend 0.8'] = v['blend']
    variants['r3-family p128 grouped k=5'] = v['grouped']
    variants['r3-family p128 curve only'] = v['curve']
    variants['r3-family p128 ridge only'] = v['ridge']
    for k in (3, 10):
        vk = cv_only(p128, lambda t, k=k: mk_r3(t, shrink_k=k), legs=('blend',))
        variants[f'r3-family p128 blend 0.8 k={k}'] = vk['blend']
    for b in (0.6, 0.7, 0.9, 1.0):
        vb = cv_only(p128, lambda t, b=b: mk_r3(t, blend=b), legs=('blend',))
        variants[f'r3-family p128 blend {b}'] = vb['blend']
    va = validate(p128, lambda t: mk_r3(t, use_age=True), legs=('blend', 'grouped', 'curve'))
    variants['age-curve p128 blend 0.8'] = va['blend']
    variants['age-curve p128 grouped'] = va['grouped']
    variants['age-curve p128 curve only'] = va['curve']
    v109 = validate(p109, lambda t: mk_r3(t), legs=('blend', 'grouped', 'curve'))
    variants['r3-family p109 blend 0.8'] = v109['blend']
    variants['r3-family p109 grouped'] = v109['grouped']
    variants['r3-family p109 curve only'] = v109['curve']
    va109 = validate(p109, lambda t: mk_r3(t, use_age=True), legs=('blend',))
    variants['age-curve p109 blend 0.8'] = va109['blend']
    res['models'] = {k: {kk: vv for kk, vv in d.items() if kk != 'loo_errors'} for k, d in variants.items()}
    for k, d in variants.items():
        print(f"  {k:32s} CV {d.get('cv_mean')} WF70 {d.get('walk_forward_70_30')} WF60 {d.get('walk_forward_60_40')} blind {d.get('blind_seed999')} LOO {d.get('loo_med_abs_log')} boot {d.get('bootstrap_oob_median')}")

    # launch odds
    print('--- launch odds ---')
    odds = evaluate_odds()
    res['odds'] = {k: v for k, v in odds.items() if k != 'model'}
    res['odds']['model'] = {k: v for k, v in odds['model'].items() if not k.startswith('_')}
    print('  hazards:', odds['model']['hazards'], '| loglik:', odds['model']['loglik'], '| weibull:', odds['model']['weibull'])
    print('  random holdout:', odds['random'])
    print('  time holdout:', odds['time'])

    # ablation (LOO geo factor = exp(median |ln err|), within-3x share)
    print('--- ablation (LOO, p128) ---')
    full = ValueModel(p128)
    loo_blend = variants['r3-family p128 blend 0.8']['loo_errors']
    def geo(errs):
        return round(math.exp(median(errs)), 2)
    def within3(errs):
        return round(sum(1 for e in errs if e <= math.log(3)) / len(errs), 3)
    # curve-only LOO errors: refit curve per left-out comp (cheap: reuse grouped LOO? recompute properly)
    loo_curve, loo_grouped, loo_ridge = [], [], []
    for i in range(len(p128)):
        train = p128[:i] + p128[i + 1:]
        m = ValueModel(train)
        t = math.log(p128[i]['mcap_usd'])
        loo_curve.append(abs(m.predict(p128[i], 'curve') - t))
        loo_grouped.append(abs(m.predict(p128[i], 'grouped') - t))
        loo_ridge.append(abs(m.predict(p128[i], 'ridge') - t))
    flat_errs = [abs(math.log(c['tvl_usd'] * 0.25) - math.log(c['mcap_usd'])) for c in p128]
    medmult_errs = [abs(math.log(c['tvl_usd'] * math.exp(starter)) - math.log(c['mcap_usd'])) for c in p128]
    res['ablation'] = [
        {'step': 'flat multiple TVL x 0.25 (starter)', 'geo': geo(flat_errs), 'within3': within3(flat_errs)},
        {'step': 'global median multiple', 'geo': geo(medmult_errs), 'within3': within3(medmult_errs)},
        {'step': 'log-log curve only', 'geo': geo(loo_curve), 'within3': within3(loo_curve)},
        {'step': 'curve + grouped shrunk medians', 'geo': geo(loo_grouped), 'within3': within3(loo_grouped)},
        {'step': 'curve + grouped + ridge-LAD blend 0.8/0.2 (this entry)', 'geo': geo(loo_blend), 'within3': within3(loo_blend)},
        {'step': 'ridge-LAD only', 'geo': geo(loo_ridge), 'within3': within3(loo_ridge)},
    ]
    for a in res['ablation']:
        print(' ', a)

    json.dump(res, open(OUT, 'w'), indent=1, default=str)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
