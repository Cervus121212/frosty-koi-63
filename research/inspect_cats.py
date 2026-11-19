import json, re
snap = json.load(open('/home/hatch/workspace/makefun/kit/token-radar-01-kit-r4/token-radar-01-kit/input/snapshot.json'))
ps = snap['protocols']
def has_token(p): return p['mcap_usd'] is not None or p['gecko_id'] is not None or p['symbol'] is not None
pre = [p for p in ps if not has_token(p)]
for cat in ['Anchor BTC','Decentralized BTC','Stablecoin Wrapper','Staking Pool','Restaking','Cross Chain Bridge','Farm','Chain','CeDeFi','Dual-Token Stablecoin']:
    rows = [p for p in pre if p['category']==cat]
    print(f'--- {cat} ({len(rows)}) ---')
    for p in rows:
        print(f"  {p['slug']:28s} {p['name']:32s} TVL ${p['tvl_usd']/1e6:9.1f}M chains={','.join(p['chains'][:3])} listed={p['listed_at']}")
# dTAO / bittensor hunt
print('--- bittensor/dtao hunt ---')
for p in ps:
    if 'tao' in p['slug'].lower() or 'bittensor' in p['slug'].lower() or 'tao' in p['name'].lower():
        print(f"  {p['slug']:28s} {p['name']:28s} cat={p['category']} TVL=${p['tvl_usd']/1e6:.1f}M mcap={p['mcap_usd']} sym={p['symbol']} gecko={p['gecko_id']}")
# radar-3 board rows 12 & 7 for slugs
b = json.load(open('/tmp/tr3-out1/board.json'))
rows = b['rows']
print('--- radar-3 board #7 and #12 ---')
for r in rows[:15]:
    print(f"  #{r['rank']:3d} {r['slug']:28s} ${r['implied_value_usd']/1e6:8.1f}M")
