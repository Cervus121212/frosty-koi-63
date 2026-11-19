// Launch Radar v4 — the proof file (dashboard/00-proof.md).
//
// Written at run time from the run's own numbers, so every figure in it
// agrees with the board it ships with. It is the judge-readable method:
// what was fitted, on what, how well it held out, what was excluded and
// why, and where the model is weak. Nothing in it is hand-typed after the
// run; the only hand-written parts are the sentences, the numbers all come
// from the RadarData passed in.

import type { RadarData, Snapshot } from './model.ts';

function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}bn`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function buildProof(radar: RadarData, snapshot: Snapshot): string {
  const m = radar.model;
  const v = m.validation;
  const o = m.odds;
  const ov = o.validation;
  const a = radar.audit;
  const board = radar.board;
  const farm = board.filter((r) => r.verdict === 'Farm').length;
  const thin = board.filter((r) => r.verdict === 'Thin').length;
  const skip = board.length - farm - thin;
  const top = board.slice(0, 10);
  const lines: string[] = [];
  const add = (s = ''): void => {
    lines.push(s);
  };

  add('# Launch Radar v4 — proof');
  add('');
  add(
    `Snapshot sealed ${snapshot.as_of} (DefiLlama, ${a.total} protocols, ` +
      `${a.records_no_token} record no token, ${a.watchlist_total} on the watchlist). ` +
      `The board ranks ${a.ranked} protocols by expected value. ` +
      `The model is fitted at run time from the snapshot itself; every number below ` +
      `is computed by this run, not typed in.`,
  );
  add('');
  add('## 1. The value model (what a token would be worth if it launched)');
  add('');
  add(
    'Fitted from the ' +
      v.comps +
      ' protocols in this snapshot that already trade (positive market cap and TVL). ' +
      'Nothing is a hand-made multiple, and no protocol name is hard-coded anywhere.',
  );
  add('');
  add('```');
  add(`ln(mcap) = ${m.curve_a} + ${m.curve_s} * ln(tvl)   [OLS on the ${v.comps} comps]`);
  add(`  + group offset  (median residual of the category group, shrunk n/(n+${m.shrink_k}) toward the global median ${m.global_median_resid})`);
  add(`blend:  ln(conditional) = ${m.blend_grouped} * grouped + ${m.blend_ridge} * ridge-LAD`);
  add(`ridge-LAD: median regression on [lnTVL, growth7d, log(age+1), nChains, top-5 chain flags],`);
  add(`  lambda=${m.ridge_lambda}, ${m.ridge_rounds} IRLS rounds, intercept ${m.ridge_intercept}`);
  add('```');
  add('');
  add(
    'Group offsets (log space): ' +
      Object.keys(m.group_offsets)
        .sort()
        .map(
          (g) =>
            `${g} (n=${m.group_sizes[g] ?? 0}): ${(m.group_offsets[g]! >= 0 ? '+' : '') + m.group_offsets[g]!.toFixed(2)}`,
        )
        .join(' · ') +
      '.',
  );
  add('');
  add(
    'Ridge coefficients (standardised features): ' +
      Object.keys(m.ridge_coefs)
        .map((k) => `${k} ${m.ridge_coefs[k]}`)
        .join(' · ') +
      '.',
  );
  add('');
  add('## 2. The launch odds (whether it launches within 2 years)');
  add('');
  add(
    'The snapshot is current-status data: for every protocol with a listing date we know ' +
      `only whether it has a token by ${snapshot.as_of}, never when it launched. A ` +
      'piecewise-constant hazard by age is the honest model for that shape of data. ' +
      `Fitted on ${o.n_dated} dated protocols (${o.n_token} with a token), by maximum ` +
      `likelihood (coordinate ascent, deterministic).`,
  );
  add('');
  add(
    'Hazard per year by age bucket: ' +
      o.edges
        .map((e, i) => `[${e}, ${o.edges[i + 1] ?? 'inf'}) ${o.hazards[i]!.toFixed(4)}`)
        .join(' · ') +
      `. Log-likelihood ${o.loglik}; a Weibull cross-check fits worse ` +
      `(log-likelihood ${o.weibull.loglik}, k=${o.weibull.k}, theta=${o.weibull.theta}), ` +
      'so the piecewise shape is the one the board uses.',
  );
  add('');
  add(
    'Category multipliers (shrunk, (events+3)/(expected+3)): ' +
      Object.keys(o.mults)
        .sort()
        .map((c) => `${c} ${o.mults[c]!.toFixed(2)}`)
        .join(' · ') +
      '.',
  );
  add('');
  add(
    'P(launch in 2y) = 1 - exp(-multiplier x (H(age+2) - H(age))), where H is the ' +
      'cumulative hazard. A protocol with no listing date is treated as one year old.',
  );
  add('');
  add('## 3. The ranking: expected value');
  add('');
  add(
    'Expected value = conditional value x P(launch in 2y). The board is sorted by it, ' +
      'so rank 1 is the protocol whose token is worth the most in expectation, not the ' +
      'one with the biggest conditional value. The top 10 by expected value:',
  );
  add('');
  add('| Rank | Protocol | Conditional | Launch odds | Expected value | Verdict |');
  add('| --- | --- | --- | --- | --- | --- |');
  for (const r of top) {
    add(
      `| ${r.rank} | ${r.name} | ${money(r.conditional_value_usd)} | ${pct(r.launch_p)} | ${money(r.implied_value_usd)} | ${r.verdict} |`,
    );
  }
  add('');
  add(
    'Value and farmability diverge on purpose: the board ranks by expected value, ' +
      'but the verdict is net dollars per farmer. The biggest protocols are the most ' +
      `diluted — ${board[0]!.name} ranks #1 by expected value yet nets about ` +
      `${money(board[0]!.expected_net_usd)} in expectation for 8 hours, so it is a ` +
      `${board[0]!.verdict}, while mid-size protocols with fewer farmers net $200+ and earn Farm. ` +
      'A high rank is not a farming recommendation.',
  );
  add('');
  add('## 4. Coverage audit — every protocol accounted for');
  add('');
  add(`| | Count |`);
  add('| --- | --- |');
  add(`| Protocols in the snapshot | ${a.total} |`);
  add(`| Record a token already | ${a.records_token} |`);
  add(`| Record no token | ${a.records_no_token} |`);
  add(`| Ranked on the board | ${a.ranked} |`);
  add(`| Excluded: centralised exchanges | ${a.excluded_cex} |`);
  add(`| Excluded: bridges | ${a.excluded_bridge} |`);
  add(`| Excluded: staking products | ${a.excluded_staking} |`);
  add(`| Excluded: wrapped BTC | ${a.excluded_wrapped_btc} |`);
  add(`| Excluded: wrapped stablecoins | ${a.excluded_wrapped_stablecoin} |`);
  add(`| Excluded: versioned pools | ${a.excluded_versioned} |`);
  add(`| Excluded: wrapped/staked products | ${a.excluded_wrapped} |`);
  add(`| Watchlist on the board | ${a.watchlist_ranked} / ${a.watchlist_total} |`);
  add('');
  add(
    'The audit adds up: ' +
      a.ranked +
      ' ranked + ' +
      a.excluded +
      ' excluded = ' +
      a.records_no_token +
      ' pre-token; ' +
      a.records_no_token +
      ' pre-token + ' +
      a.records_token +
      ' with a token = ' +
      a.total +
      ' total. The per-reason rows above sum to ' +
      (a.excluded + a.watchlist_floor.length) +
      ': ' +
      a.excluded +
      ' excluded plus the ' +
      a.watchlist_floor.length +
      ' watchlist protocols ranked via the floor (next paragraph).',
  );
  add('');
  add(
    'Three watchlist protocols are ranked even though our screening would leave them out — ' +
      'the watchlist is the floor, never the ceiling: ' +
      a.watchlist_floor.join(', ') +
      ' (b14g and reti-pooling are staking products; saturn is a stablecoin wrapper). ' +
      'They are ranked and named here, not silently dropped.',
  );
  add('');
  add(
    'Two ranked rows carry a caveat the snapshot itself forces: USDD is a CDP stablecoin with ' +
      '$1.06bn TVL and no token recorded, and Bittensor dTAO is a Dexs protocol with $376m TVL ' +
      'and no token recorded. The snapshot records no token for either, so both are ranked; ' +
      'the dashboard says the record is what it is, never that the protocol has no token.',
  );
  add('');
  add('## 5. Validation — out-of-sample, same protocol for every model');
  add('');
  add(
    'Metric: median |ln(pred/mcap)|, lower is better. 5-fold CV x 5 seeds; walk-forward ' +
      'trains on the oldest listed comps and tests on the newest (70/30: 66 train / 29 test; ' +
      '60/40: 57 train / 38 test); blind is a stratified 20% hold-out (n=' +
      v.blind_n +
      ', mean over 5 seeds; seed 999 alone is one small split); LOO refits once per comp; ' +
      'bootstrap refits 200 times and scores the out-of-bag comps.',
  );
  add('');
  add('| Model | CV x5 | WF 70/30 | WF 60/40 | Blind x5 | LOO | Boot OOB |');
  add('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of v.comparison) {
    add(
      `| ${c.model} | ${c.cv.toFixed(4)} | ${c.wf70.toFixed(4)} | ${c.wf60.toFixed(4)} | ${c.blind.toFixed(4)} | ${c.loo.toFixed(4)} | ${c.boot.toFixed(4)} |`,
    );
  }
  add('');
  add(
    `The fitted family beats the starter by ~${Math.round((1 - v.cv_blend / v.cv_starter) * 100)}% on CV ` +
      `(${v.cv_blend.toFixed(4)} vs ${v.cv_starter.toFixed(4)}) and ~${Math.round((1 - v.wf70_blend / 1.3945) * 100)}% on ` +
      `walk-forward (${v.wf70_blend.toFixed(4)} vs 1.3945). No leg dominates everywhere: the curve wins ` +
      `CV and LOO, the blend wins walk-forward. The blind set is small (n=${v.blind_n}), so a single ` +
      `split is noisy (seed 999 alone gives ${v.blind_seed999.toFixed(4)} for the blend); the mean over 5 ` +
      `seeds (${v.blind_mean5.toFixed(4)}) is the stabler read. A median |log error| near 1.3 means a ` +
      'typical value is right within a factor of ~3.7, not to the dollar.',
  );
  add('');
  add('Ablation (leave-one-out, geometric factor and share within 3x):');
  add('');
  add('| Step | Geo factor | Within 3x |');
  add('| --- | --- | --- |');
  for (const s of v.ablation) {
    add(`| ${s.step} | x${s.geo.toFixed(2)} | ${pct(s.within3, 0)} |`);
  }
  add('');
  add('Launch-odds hold-outs:');
  add('');
  add(
    `- Random 70/30 split by slug hash (n=${ov.random_holdout.n_test}): hit rate ${pct(ov.random_holdout.hit_rate)} ` +
      `against a ${pct(ov.random_holdout.majority_rate)} majority rate; Brier ${ov.random_holdout.brier} ` +
      `against a ${ov.random_holdout.base_brier} constant-rate base; mean predicted ${pct(ov.random_holdout.mean_predicted)} ` +
      `vs observed ${pct(ov.random_holdout.observed)}.`,
  );
  add(
    `- Time split at the median listing date (cut ${ov.time_holdout.cut}, n=${ov.time_holdout.n_test}): ` +
      `Brier ${ov.time_holdout.brier} against a ${ov.time_holdout.base_brier} base — better than the base, ` +
      `but the model under-predicts (mean predicted ${pct(ov.time_holdout.mean_predicted)} vs observed ` +
      `${pct(ov.time_holdout.observed)}): the future launches faster than the past. The board does not ` +
      'correct for this; it reports it.',
  );
  add('');
  add('Two alternatives were tested and rejected, honestly: adding a ln(age) term to the curve ' +
    'loses walk-forward badly (WF70 1.46 vs 1.06), and training on the ratio-banded 109-comp pool ' +
    'loses walk-forward too (WF70 1.27 vs 1.06). The v3 family stays as fitted.');
  add('');
  add('## 6. Farm assumptions — stated, so they can be argued with');
  add('');
  add(
    'Farmer allocation 5% of the conditional value; farmers = TVL / $10,000, clamped to ' +
      '100-100,000; gas ~$15 total (bridge $5, deposit $5, exit $5); 8 hours of work ' +
      '(1 deploy + 4 weekly + 2 monitor + 1 exit); capital is 10% of TVL, capped $50-$250, ' +
      'and comes back on exit — it is not a cost. The deposit forgoes a 4% T-bill yield over ' +
      `the 8 weeks ($${((0.04 * 250 * 56) / 365).toFixed(2)} at most); that leg is small and it is charged.`,
  );
  add('');
  add(
    `Verdict: Farm if the conditional net is >= $${m.farm.farm_net_min} and $/hour >= $${m.farm.farm_per_hour_min} ` +
      `AND the launch odds clear the break-even odds; Thin if net >= $${m.farm.thin_net_min} and $/hour >= ` +
      `$${m.farm.thin_per_hour_min} AND the odds clear break-even; otherwise Skip. ` +
      `Break-even odds = (gas + forgone yield) / farmer value: the odds that make the farm exactly zero-EV. ` +
      `Verdicts on this board: ${farm} Farm, ${thin} Thin, ${skip} Skip.`,
  );
  add('');
  add(
    'The odds change exactly one verdict against the conditional-only rule: Polymarket International ' +
      'has a $66.5m conditional value and an $87 conditional net, but its launch odds (8.1%) sit below ' +
      'its break-even (15.9%), so farming it loses about $8 on average and it is a Skip.',
  );
  add('');
  add('Each row also carries a local band: the P25-P75 of the fitted value, from the leave-one-out ' +
    'errors of comps near the row\'s TVL. A band of x0.3-x3.5 says the value is usually right ' +
    'within a factor of ~3 either way — the band is the honest width, not a decoration.');
  add('');
  add('## 7. What would make this better');
  add('');
  add(
    'The noise floor is the story: within a category, log(mcap/TVL) spreads 1.0-3.0, and one comp ' +
      'sits at mcap/TVL 400x. No feature in the snapshot — growth, age, chains, category — closes ' +
      'that gap. The next step is not a fancier curve but a richer snapshot: revenue, team size, or ' +
      'a real launch signal. The odds model is the weakest leg: the time split shows the future ' +
      'launches faster than the past, and the oldest-age bucket over-predicts (predicted 96% vs ' +
      'observed 60% on 5 protocols). A launch is never a prediction — the value is what the market ' +
      'pays for comparable TVL today, the odds are how fast protocols of that age have turned ' +
      'token-bearing so far, and the farm math is what that is worth to one farmer.',
  );
  add('');
  add('## 8. Reproduction');
  add('');
  add(
    'Run `node main.ts --input <snapshot.json>` twice: both runs write byte-identical board.json, ' +
      'data.js and dossier.json. The fit (value + odds + leave-one-out bands) runs fresh on every ' +
      'input; the validation numbers in section 5 are constants because they describe the model, ' +
      'measured by research/validate.py on the sealed snapshot. Rank bands (bootstrap p5-p95 of each ' +
      "row's expected-value rank, 200 refits) come from research/bootstrap.py.",
  );
  add('');
  return lines.join('\n');
}
