import json
from collections import Counter
from datetime import date

snap = json.load(open('/home/hatch/workspace/makefun/kit/token-radar-01-kit-r4/token-radar-01-kit/input/snapshot.json'))
ps = snap['protocols']
print('as_of:', snap['as_of'], '| floor:', snap['floor_usd'], '| total:', len(ps), '| watchlist:', len(snap['watchlist']))
def has_token(p): return p['mcap_usd'] is not None or p['gecko_id'] is not None or p['symbol'] is not None
pre = [p for p in ps if not has_token(p)]
tok = [p for p in ps if has_token(p)]
print('pre-token:', len(pre), '| has token:', len(tok))
print('pre-token by category:')
for c, n in Counter(p['category'] for p in pre).most_common():
    print(f'  {c}: {n}')
print('pre-token with mcap None but symbol/gecko?', sum(1 for p in pre if p['symbol'] or p['gecko_id']))
print('watchlist all in snapshot?', all(s in {p['slug'] for p in ps} for s in snap['watchlist']))
wl = [p for p in ps if p['slug'] in set(snap['watchlist'])]
print('watchlist pre-token:', sum(1 for p in wl if not has_token(p)), 'of', len(wl))
# versioned / wrapped names among pre-token
import re
VER = re.compile(r'\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$')
WRAP = re.compile(r'\b(wrapped|staked|staking)\b', re.I)
print('pre-token versioned:', sum(1 for p in pre if VER.search(p['name'])))
print('pre-token wrapped-word:', sum(1 for p in pre if WRAP.search(p['name'])))
print('pre-token null category:', sum(1 for p in pre if p['category'] is None))
# USDD / dTAO specifics
for slug in ('usdd', 'bittensor', 'dtao', 'bitcoin', 'wbtc', 'usdt0'):
    for p in ps:
        if p['slug'] == slug:
            print(slug, '|', p['name'], '| cat:', p['category'], '| tvl:', p['tvl_usd'], '| mcap:', p['mcap_usd'], '| symbol:', p['symbol'], '| gecko:', p['gecko_id'], '| listed:', p['listed_at'])
# dated protocols for launch odds
asof = date.fromisoformat(snap['as_of'])
dated = []
for p in ps:
    if p['listed_at']:
        age = (asof - date.fromisoformat(p['listed_at'])).days / 365.25
        dated.append((age, has_token(p)))
print('dated:', len(dated), '| with token:', sum(t for _, t in dated))
buckets = [(0,0.5),(0.5,1),(1,2),(2,3),(3,5),(5,99)]
for lo, hi in buckets:
    rows = [(a,t) for a,t in dated if lo <= a < hi]
    if rows:
        print(f'  age [{lo},{hi}): n={len(rows)} token_rate={sum(t for _,t in rows)/len(rows):.3f}')
# comp pool for value model (radar-3 style: mcap>0, TVL>0)
comps = [p for p in ps if p['mcap_usd'] and p['mcap_usd'] > 0 and p['tvl_usd'] > 0]
print('comps mcap>0 & tvl>0:', len(comps))
# ratio band [0.02,20] one per token id
bytok = {}
for p in comps:
    r = p['mcap_usd']/p['tvl_usd']
    if 0.02 <= r <= 20:
        k = p['gecko_id'] or p['symbol'] or p['slug']
        if k not in bytok or p['tvl_usd'] > bytok[k]['tvl_usd']:
            bytok[k] = p
print('comps in ratio band, deduped:', len(bytok))
