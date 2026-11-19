// Launch Radar v4 — a fitted value model for pre-token protocols
// (token-radar-01), ranked by EXPECTED value.
//
// What changed from v3, and why:
//   v3 ranked by the conditional value: what a token would be worth IF it
//   launched. That crowns old giants that may never launch — Polymarket
//   International sat at #4 on a $66.5m conditional value while its launch
//   odds are 8.1%. v4 ranks by expected value = conditional value x
//   P(launch within 2 years), where the odds come from the snapshot's own
//   listing dates (lib/launch-odds.ts). The same change demotes exactly one
//   farm verdict: Polymarket's conditional net is $87 but its odds sit below
//   its break-even, so farming it is negative-EV and it is a Skip.
//
//   The value fit is the v3 family, unchanged, because the honest tests
//   said to keep it: adding a ln(age) term to the curve loses walk-forward
//   badly (WF70 1.46 vs 1.06), and training on the ratio-banded 109-comp
//   pool loses walk-forward too (WF70 1.27 vs 1.06). The family is
//   log-log OLS + grouped shrunk medians + ridge-LAD, blended 0.8/0.2.
//
//   ln(mcap) = a + s * ln(tvl)                    OLS log-log curve
//   + shrunk group offset                         median residual of the
//                                                 category group, shrunk
//                                                 n/(n+5) toward the global
//                                                 median residual
//   blended 0.8 * grouped + 0.2 * ridge-LAD      ridge leg: median
//                                                 regression on lnTVL,
//                                                 7-day growth, log age,
//                                                 chain count, top-5 chain
//                                                 flags
//
// Out-of-sample validation, same protocol for every model, metric median
// |ln(pred/mcap)| (lower is better) — full table in research/validate.py
// and research/validation-results.json, summarised on the dashboard:
//   5-fold CV x 5 seeds:  blend 1.295 | grouped 1.288 | curve 1.243
//                          | starter flat x0.25: 1.550 | old model: 1.673
//   walk-forward 70/30:    blend 1.059 (best) | grouped 1.072
//   walk-forward 60/40:    blend 1.130 | grouped 1.139 | curve 1.058
//   leave-one-out:         blend 1.306 | grouped 1.327 | curve 1.223
//   blind 20% hold-out:    mean over 5 seeds: blend 1.408 | grouped 1.362
//                          (seed 999 alone: blend 1.569 — one small split)
//   bootstrap 200 refits:  out-of-bag median blend 1.277 | grouped 1.266
// The fitted family beats the starter by ~16% on CV and ~24% on
// walk-forward. No leg dominates everywhere: the curve wins CV and LOO,
// the blend wins walk-forward — the dashboard shows the whole table and
// says so. Sensitivity is flat: blend 0.6/0.7/0.8/0.9/1.0 CV
// 1.308/1.308/1.295/1.298/1.288; shrink k=3/5/10 CV 1.305/1.295/1.289.
// The noise floor is real: within-category log(mcap/TVL) spreads 1.0-3.0,
// and one comp sits at mcap/TVL 400x.
//
// Farm plan, in dollars (assumptions on the dashboard method page):
//   farmers      = clamp(round(tvl / 10,000), 100, 100,000)
//   farmerValue  = conditional * 5% / farmers   (the slice IF it launches)
//   gas          = ~$15 total (bridge $5 + deposit $5 + exit $5)
//   tbill        = 4% * capital * 56/365        (the yield the deposit
//                                                 forgoes over 8 weeks)
//   net          = farmerValue - gas - tbill;  hours = 8
//   expected net = farmerValue * P(launch) - gas - tbill
//   break-even p = (gas + tbill) / farmerValue  (the odds that make the
//                                                 farm exactly zero-EV)
//   verdict      = Farm if net >= $200 and $/hour >= $25 AND P >= break-even;
//                  Thin if net >= $50 and $/hour >= $10 AND P >= break-even;
//                  else Skip.
// Capital is sized per protocol (10% of TVL, capped $50-$250) and is NOT
// a cost: it comes back on exit. The verdict is the conditional payoff
// gated by positive expected value — a big payoff with odds below
// break-even is a Skip, not a Farm.

import { fitOdds, launchP, ODDS_VALIDATION, type FittedOdds } from './launch-odds.ts';

export interface ProtocolRow {
  slug: string;
  name: string;
  symbol: string | null;
  gecko_id: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  listed_at: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRow[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface CompactRow {
  slug: string;
  name: string;
  category: string;
  rank: number;
  /** The board's ranking value: the EXPECTED value (conditional x odds). */
  implied_value_usd: number;
  /** What the token would be worth if it launched. */
  conditional_value_usd: number;
  launch_p: number;
  tvl_usd: number;
  growth_7d: number | null;
  age_days: number | null;
  chains: string[];
  watchlist: boolean;
  farmer_value_usd: number;
  expected_farmer_value_usd: number;
  farmers: number;
  capital_usd: number;
  net_usd: number;
  expected_net_usd: number;
  usd_per_hour: number;
  expected_usd_per_hour: number;
  break_even_p: number;
  band_lo_usd: number;
  band_hi_usd: number;
  ev_band_lo_usd: number;
  ev_band_hi_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
  rank_lo: number;
  rank_hi: number;
  curve_usd: number;
  grouped_usd: number;
  ridge_usd: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface ValidationComparison {
  model: string;
  cv: number;
  wf70: number;
  wf60: number;
  blind: number;
  blind_seed999: number;
  loo: number;
  boot: number;
}

export interface ValidationReport {
  metric: string;
  comps: number;
  dated_comps: number;
  cv_blend: number;
  cv_grouped: number;
  cv_curve: number;
  cv_starter: number;
  cv_old: number;
  cv_sd: number;
  wf70_blend: number;
  wf60_blend: number;
  wf70_grouped: number;
  wf60_grouped: number;
  blind_mean5: number;
  blind_seed999: number;
  blind_n: number;
  loo_blend: number;
  boot_oob_median: number;
  sensitivity_blend: Record<string, number>;
  sensitivity_shrink: Record<string, number>;
  comparison: ValidationComparison[];
  ablation: { step: string; geo: number; within3: number }[];
}

export interface AuditCounts {
  total: number;
  records_no_token: number;
  records_token: number;
  live_with_mcap: number;
  token_recorded_no_mcap: number;
  ranked: number;
  excluded: number;
  excluded_cex: number;
  excluded_bridge: number;
  excluded_staking: number;
  excluded_wrapped_btc: number;
  excluded_wrapped_stablecoin: number;
  excluded_versioned: number;
  excluded_wrapped: number;
  watchlist_total: number;
  watchlist_ranked: number;
  watchlist_floor: string[];
}

export interface ModelInfo {
  name: string;
  version: string;
  curve_a: number;
  curve_s: number;
  global_median_resid: number;
  group_offsets: Record<string, number>;
  group_sizes: Record<string, number>;
  ridge_lambda: number;
  ridge_rounds: number;
  ridge_intercept: number;
  ridge_coefs: Record<string, number>;
  ridge_chains: string[];
  blend_grouped: number;
  blend_ridge: number;
  shrink_k: number;
  odds: {
    hazards: number[];
    edges: number[];
    mults: Record<string, number>;
    loglik: number;
    weibull: { k: number; theta: number; loglik: number };
    n_dated: number;
    n_token: number;
    validation: typeof ODDS_VALIDATION;
  };
  validation: ValidationReport;
  farm: {
    allocation_pct: number;
    tvl_per_farmer: number;
    farmers_min: number;
    farmers_max: number;
    gas_total_usd: number;
    hours_total: number;
    tbill_rate: number;
    tbill_days: number;
    farm_net_min: number;
    farm_per_hour_min: number;
    thin_net_min: number;
    thin_per_hour_min: number;
  };
}

export interface ScatterPoint {
  x: number;
  y: number;
  yh: number;
}

export interface RadarData {
  model: ModelInfo;
  audit: AuditCounts;
  board: CompactRow[];
  live: LiveRow[];
  scatter: { points: ScatterPoint[]; line: [number, number, number, number] };
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The validation numbers, measured by research/validate.py on the sealed
 *  snapshot (128 comps). They are constants here because they describe the
 *  model, not the snapshot — the fit itself runs fresh on every input. */
export const VALIDATION: ValidationReport = {
  metric: 'median |ln(pred/mcap)|, lower is better',
  comps: 128,
  dated_comps: 95,
  cv_blend: 1.295,
  cv_grouped: 1.2881,
  cv_curve: 1.2434,
  cv_starter: 1.5503,
  cv_old: 1.6727,
  cv_sd: 0.2642,
  wf70_blend: 1.059,
  wf60_blend: 1.1301,
  wf70_grouped: 1.0723,
  wf60_grouped: 1.1391,
  blind_mean5: 1.4083,
  blind_seed999: 1.569,
  blind_n: 26,
  loo_blend: 1.3061,
  boot_oob_median: 1.2769,
  sensitivity_blend: { '0.6': 1.3081, '0.7': 1.3075, '0.8': 1.295, '0.9': 1.2977, '1.0': 1.2881 },
  sensitivity_shrink: { '3': 1.3049, '5': 1.295, '10': 1.2887 },
  comparison: [
    { model: 'blend 0.8 grouped + 0.2 ridge-LAD (this entry)', cv: 1.295, wf70: 1.059, wf60: 1.1301, blind: 1.4083, blind_seed999: 1.569, loo: 1.3061, boot: 1.2769 },
    { model: 'grouped shrunk medians k=5', cv: 1.2881, wf70: 1.0723, wf60: 1.1391, blind: 1.3619, blind_seed999: 1.394, loo: 1.3266, boot: 1.2664 },
    { model: 'global log-log curve only', cv: 1.2434, wf70: 1.2271, wf60: 1.0575, blind: 1.4601, blind_seed999: 1.4195, loo: 1.2234, boot: 1.2957 },
    { model: 'ridge-LAD only', cv: 1.352, wf70: 1.1051, wf60: 1.3582, blind: 1.5186, blind_seed999: 1.5854, loo: 1.3892, boot: 1.4148 },
    { model: 'starter flat TVL x 0.25', cv: 1.5503, wf70: 1.3945, wf60: 1.4621, blind: 1.526, blind_seed999: 1.3873, loo: 1.5914, boot: 1.6017 },
    { model: 'old median-multiple (radar-2)', cv: 1.6727, wf70: 1.3835, wf60: 1.7423, blind: 1.5807, blind_seed999: 1.3939, loo: 1.7187, boot: 1.6606 },
  ],
  ablation: [
    { step: 'flat multiple TVL x 0.25 (starter)', geo: 4.91, within3: 0.336 },
    { step: 'global median multiple', geo: 4.86, within3: 0.352 },
    { step: 'log-log curve only', geo: 3.4, within3: 0.422 },
    { step: 'curve + grouped shrunk medians', geo: 3.77, within3: 0.445 },
    { step: 'curve + grouped + ridge-LAD blend 0.8/0.2 (this entry)', geo: 3.69, within3: 0.438 },
    { step: 'ridge-LAD only', geo: 4.01, within3: 0.414 },
  ],
};

export const MODEL_NAME = 'Launch Radar v4';
export const MODEL_VERSION = 'radar-4';
export const BLEND_GROUPED = 0.8;
export const BLEND_RIDGE = 0.2;
export const SHRINK_K = 5;
export const RIDGE_LAMBDA = 10;
export const RIDGE_ROUNDS = 40;
export const LAD_DELTA = 0.1;
export const FARM_ALLOCATION_PCT = 0.05;
export const TVL_PER_FARMER = 10_000;
export const FARMERS_MIN = 100;
export const FARMERS_MAX = 100_000;
export const GAS_TOTAL_USD = 15;
export const HOURS_TOTAL = 8;
export const TBILL_RATE = 0.04;
export const TBILL_DAYS = 56;
export const FARM_NET_MIN = 200;
export const FARM_PER_HOUR_MIN = 25;
export const THIN_NET_MIN = 50;
export const THIN_PER_HOUR_MIN = 10;

/** Near-duplicate categories share one group. Everything else stands alone;
 *  the shrink factor pulls small groups toward the global median, so a
 *  1-comp group barely moves the curve. */
export const GROUP_POOL: Record<string, string> = {
  Bridge: 'Bridge',
  'Canonical Bridge': 'Bridge',
  'Cross Chain Bridge': 'Bridge',
  'Liquid Staking': 'Staking',
  'Liquid Restaking': 'Staking',
  Restaking: 'Staking',
  'Staking Pool': 'Staking',
  Yield: 'Yield',
  'Yield Aggregator': 'Yield',
  'Leveraged Farming': 'Yield',
  Lending: 'Lending',
  CDP: 'Lending',
  'Collateral Management': 'Lending',
  'AI Agents': 'AI',
  'Decentralized AI': 'AI',
  Dexs: 'Dexs',
  'Liquidity Manager': 'Dexs',
};

export function groupOf(category: string | null): string {
  if (category === null) return 'Unknown';
  return GROUP_POOL[category] ?? category;
}

/** A name that is a versioned pool of another protocol (v2, V3, 2.0 ...). */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** The first word of an exchange's name, for exchange products. */
const EXCHANGE_FIRST = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

function isVersioned(name: string): boolean {
  return VERSIONED.test(name);
}

function isWrappedProduct(name: string): boolean {
  return WRAPPED_WORD.test(name);
}

function isExchangeProduct(name: string): boolean {
  return EXCHANGE_FIRST.test(name);
}

/** The protocol records no token at all: no mcap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: ProtocolRow): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is NOT ranked, or null when it is ranked.
 *  The reasons are our own reading of the snapshot, in order:
 *  an exchange is a custodian, not a launch candidate; a bridge moves
 *  other tokens; a staking product is a receipt for a token that already
 *  trades; a wrapped-BTC or wrapped-stablecoin product is a wrapper, not
 *  a new token; a versioned name is a pool of another protocol; a wrapped
 *  or staked word in the name says the same; a name that begins with an
 *  exchange's name is that exchange's product. */
export function screenReason(p: ProtocolRow): string | null {
  if (!recordsNoToken(p)) return 'has-token';
  if (p.category === 'CEX') return 'exchange';
  if (
    p.category === 'Bridge' ||
    p.category === 'Canonical Bridge' ||
    p.category === 'Cross Chain Bridge'
  )
    return 'bridge';
  if (
    p.category === 'Liquid Staking' ||
    p.category === 'Liquid Restaking' ||
    p.category === 'Restaking' ||
    p.category === 'Restaked BTC' ||
    p.category === 'Staking Pool'
  )
    return 'staking-product';
  if (p.category === 'Anchor BTC' || p.category === 'Decentralized BTC') return 'wrapped-btc';
  if (p.category === 'Stablecoin Wrapper') return 'wrapped-stablecoin';
  if (isVersioned(p.name)) return 'versioned-name';
  if (isWrappedProduct(p.name)) return 'wrapped-name';
  if (isExchangeProduct(p.name)) return 'exchange-product';
  return null;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const k = (sorted.length - 1) * (q / 100);
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  return sorted[f]! + (sorted[c]! - sorted[f]!) * (k - f);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function ageDays(p: ProtocolRow, asOf: string): number | null {
  if (!p.listed_at) return null;
  const a = new Date(`${asOf}T00:00:00Z`).getTime();
  const b = new Date(`${p.listed_at}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** Solve a small dense linear system by Gaussian elimination with partial
 *  pivoting. Used for the OLS normal equations and the ridge IRLS steps. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) throw new Error('solveLinear: singular matrix');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

function topChains(comps: ProtocolRow[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const c of comps) {
    for (const ch of c.chains) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, k)
    .map(([ch]) => ch);
}

/** Ridge-LAD features. No category: the grouped leg already carries it. */
function ridgeFeatures(
  p: ProtocolRow,
  asOf: string,
  chainsTop: string[],
): number[] {
  const growth = clamp(p.change_7d ?? 0, -50, 100) / 100;
  const age = ageDays(p, asOf) ?? 365;
  const logAge = Math.log(Math.max(age, 1) + 1);
  const flags = chainsTop.map((ch) => (p.chains.includes(ch) ? 1 : 0));
  return [Math.log(p.tvl_usd), growth, logAge, p.chains.length, ...flags];
}

interface FittedModel {
  curveA: number;
  curveS: number;
  globalMedianResid: number;
  offsets: Record<string, number>;
  groupSizes: Record<string, number>;
  ridgeChains: string[];
  ridgeMean: number[];
  ridgeSd: number[];
  ridgeBeta: number[];
}

function fitModel(snapshot: Snapshot, comps: ProtocolRow[]): FittedModel {
  if (comps.length < 10) throw new Error('fitModel: fewer than 10 comps');

  // --- global log-log curve by OLS on ln(mcap) ~ 1 + ln(tvl)
  const xs = comps.map((c) => Math.log(c.tvl_usd));
  const ys = comps.map((c) => Math.log(c.mcap_usd!));
  const n = comps.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i]!, 0);
  const curveS = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const curveA = (sy - curveS * sx) / n;

  // --- grouped shrunk medians of the curve residuals
  const resid = comps.map((c, i) => ys[i]! - (curveA + curveS * xs[i]!));
  const globalMedianResid = median(resid);
  const byGroup = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const g = groupOf(c.category);
    const arr = byGroup.get(g) ?? [];
    arr.push(resid[i]!);
    byGroup.set(g, arr);
  });
  const offsets: Record<string, number> = {};
  const groupSizes: Record<string, number> = {};
  for (const [g, rs] of [...byGroup.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const w = rs.length / (rs.length + SHRINK_K);
    offsets[g] = w * median(rs) + (1 - w) * globalMedianResid;
    groupSizes[g] = rs.length;
  }

  // --- ridge-LAD leg: median regression by IRLS, ridge lambda on all
  //     coefficients except the intercept; features standardised on comps.
  const chainsTop = topChains(comps, 5);
  const X = comps.map((c) => ridgeFeatures(c, snapshot.as_of, chainsTop));
  const d = X[0]!.length;
  const mean = X[0]!.map((_, j) => X.reduce((a, row) => a + row[j]!, 0) / n);
  const sd = X[0]!.map((_, j) => {
    const v = X.reduce((a, row) => a + (row[j]! - mean[j]!) ** 2, 0) / n;
    const s = Math.sqrt(v);
    return s === 0 ? 1 : s;
  });
  const Xs = X.map((row) => [1, ...row.map((v, j) => (v - mean[j]!) / sd[j]!)]);
  let beta = solveLinear(
    Xs[0]!.map((_, j) => Xs[0]!.map((_, k) => Xs.reduce((a, row) => a + row[j]! * row[k]!, 0))),
    Xs[0]!.map((_, j) => Xs.reduce((a, row, i) => a + row[j]! * ys[i]!, 0)),
  );
  for (let round = 0; round < RIDGE_ROUNDS; round++) {
    const w = comps.map((_, i) => {
      const r = ys[i]! - Xs[i]!.reduce((a, v, j) => a + v * beta[j]!, 0);
      return 1 / Math.max(Math.abs(r), LAD_DELTA);
    });
    const A = Xs[0]!.map((_, j) =>
      Xs[0]!.map((_, k) => {
        let s = Xs.reduce((a, row, i) => a + w[i]! * row[j]! * row[k]!, 0);
        if (j === k && j > 0) s += RIDGE_LAMBDA;
        return s;
      }),
    );
    const rhs = Xs[0]!.map((_, j) => Xs.reduce((a, row, i) => a + w[i]! * row[j]! * ys[i]!, 0));
    beta = solveLinear(A, rhs);
  }

  return {
    curveA,
    curveS,
    globalMedianResid,
    offsets,
    groupSizes,
    ridgeChains: chainsTop,
    ridgeMean: mean,
    ridgeSd: sd,
    ridgeBeta: beta,
  };
}

interface ModelParts {
  curve: number;
  grouped: number;
  ridge: number;
  blended: number;
}

/** The three legs in log space, so the dashboard can show how each one
 *  moves a protocol's value. */
function predictParts(p: ProtocolRow, snapshot: Snapshot, m: FittedModel): ModelParts {
  const curve = m.curveA + m.curveS * Math.log(p.tvl_usd);
  const grouped = curve + (m.offsets[groupOf(p.category)] ?? m.globalMedianResid);
  const feats = ridgeFeatures(p, snapshot.as_of, m.ridgeChains);
  const xs = [1, ...feats.map((v, j) => (v - m.ridgeMean[j]!) / m.ridgeSd[j]!)];
  const ridge = xs.reduce((a, v, j) => a + v * m.ridgeBeta[j]!, 0);
  return { curve, grouped, ridge, blended: BLEND_GROUPED * grouped + BLEND_RIDGE * ridge };
}

const CATEGORY_ACTION: Record<string, string> = {
  Lending: 'supply collateral and open a borrow position',
  Dexs: 'provide liquidity to the top pool',
  Yield: 'deposit into the highest-APY vault',
  'Yield Aggregator': 'deposit into the highest-APY vault',
  RWA: 'buy the tokenised asset and hold it',
  Bridge: 'bridge assets across the protocol route',
  'Canonical Bridge': 'bridge assets across the protocol route',
  'Cross Chain Bridge': 'bridge assets across the protocol route',
  'Liquid Staking': 'stake and hold the receipt token',
  'Liquid Restaking': 'stake and hold the receipt token',
  Restaking: 'stake and hold the receipt token',
  'Staking Pool': 'stake and hold the receipt token',
  Derivatives: 'open a hedged position',
  Options: 'open a hedged position',
  'Basis Trading': 'open a hedged position',
  'Onchain Capital Allocator': 'deposit into the managed vault',
  'Risk Curators': 'deposit into the curated vault',
  'Prediction Market': 'take a position on the live markets',
  Chain: 'use the chain with real volume',
};

function actionFor(p: ProtocolRow): string {
  return CATEGORY_ACTION[p.category ?? ''] ?? 'use the protocol with real volume';
}

function money(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}bn`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export interface FarmMath {
  capital: number;
  farmers: number;
  farmerValue: number;
  expectedFarmerValue: number;
  net: number;
  expectedNet: number;
  perHour: number;
  expectedPerHour: number;
  tbill: number;
  breakEven: number;
  verdict: 'Farm' | 'Thin' | 'Skip';
}

/** The farm math, in dollars. The verdict is the conditional payoff gated
 *  by positive expected value: a big payoff with launch odds below
 *  break-even is a Skip, because the farm loses money on average. */
export function farmMath(conditional: number, tvl: number, p: number): FarmMath {
  const capital = clamp(Math.round(tvl * 0.1), 50, 250);
  const farmers = clamp(Math.round(tvl / TVL_PER_FARMER), FARMERS_MIN, FARMERS_MAX);
  const farmerValue = (conditional * FARM_ALLOCATION_PCT) / farmers;
  const tbill = TBILL_RATE * capital * (TBILL_DAYS / 365);
  const net = farmerValue - GAS_TOTAL_USD - tbill;
  const perHour = net / HOURS_TOTAL;
  const expectedFarmerValue = farmerValue * p;
  const expectedNet = expectedFarmerValue - GAS_TOTAL_USD - tbill;
  const expectedPerHour = expectedNet / HOURS_TOTAL;
  const breakEven = (GAS_TOTAL_USD + tbill) / farmerValue;
  const verdict: FarmMath['verdict'] =
    net >= FARM_NET_MIN && perHour >= FARM_PER_HOUR_MIN && p >= breakEven
      ? 'Farm'
      : net >= THIN_NET_MIN && perHour >= THIN_PER_HOUR_MIN && p >= breakEven
        ? 'Thin'
        : 'Skip';
  return {
    capital,
    farmers,
    farmerValue,
    expectedFarmerValue,
    net,
    expectedNet,
    perHour,
    expectedPerHour,
    tbill,
    breakEven,
    verdict,
  };
}

function farmSteps(p: ProtocolRow, conditional: number, ev: number, prob: number, fm: FarmMath): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const action = actionFor(p);
  const actionCap = action.charAt(0).toUpperCase() + action.slice(1);
  const worth =
    fm.verdict === 'Skip' && prob < fm.breakEven
      ? `worth about ${money(fm.farmerValue)} each before costs if it launches, but the launch odds (${pct(prob)}) sit below the break-even odds (${pct(fm.breakEven)}) — farming it loses about ${money(-fm.expectedNet)} on average, so this is a watch, not a farm`
      : fm.verdict === 'Skip'
        ? `worth about ${money(fm.farmerValue)} each before costs if it launches — net ${money(fm.net)} after ~$${GAS_TOTAL_USD} gas and ${money(fm.tbill)} forgone yield, below the $${THIN_NET_MIN} net bar, so this is a watch, not a farm`
        : `worth about ${money(fm.farmerValue)} each before costs if it launches — net ${money(fm.net)} after ~$${GAS_TOTAL_USD} gas and ${money(fm.tbill)} forgone yield, ${money(fm.perHour)}/hour over ${HOURS_TOTAL}h; in expectation ${money(fm.expectedNet)} at ${pct(prob)} launch odds`;
  return [
    `Bridge ${money(fm.capital)} to ${chain} for gas and the deposit (about $5 gas, 10 minutes). Keep the receipt; the deposit chain is where the points land.`,
    `${actionCap} with ${money(fm.capital)} on ${chain} (capital ${money(fm.capital)}, about 1 hour including approvals). Do not split it across wallets.`,
    `Use the position weekly: repeat the core action at least 8 times over 8 weeks (about 30 minutes each, 4 hours total). One deposit with no activity scores nothing.`,
    `Hold the full ${money(fm.capital)} for the whole 8 weeks. Withdrawing early forfeits the points; a launch snapshot can fall on any week.`,
    `Check the position weekly (about 15 minutes each, 2 hours total). Top up if your share of TVL falls, and keep a note of every transaction hash.`,
    `Exit after the launch or after 8 weeks with no launch: withdraw in one transaction (about $5 gas, 1 hour). The ${money(fm.capital)} capital comes back; only the ~$${GAS_TOTAL_USD} gas is spent, plus ${money(fm.tbill)} of yield the deposit forgoes.`,
    `What it could be worth: if ${p.name} launches at the model's ${money(conditional)}, the expected value is ${money(ev)} at ${pct(prob)} launch odds, and a ${FARM_ALLOCATION_PCT * 100}% farmer allocation split across ~${fm.farmers.toLocaleString('en-US')} farmers is ${worth}. Verdict: ${fm.verdict}.`,
  ];
}

/** Leave-one-out errors of the blend leg, refit once per comp. The local
 *  band for a row is the P25-P75 of exp(error) among comps near the row's
 *  TVL: how far the fitted value usually misses, for protocols of that
 *  size. Refit at run time, so the band follows the input snapshot. */
function looErrors(snapshot: Snapshot, comps: ProtocolRow[]): { lnTvl: number; err: number }[] {
  const out: { lnTvl: number; err: number }[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const m = fitModel(snapshot, train);
    const pred = predictParts(comps[i]!, snapshot, m).blended;
    out.push({ lnTvl: Math.log(comps[i]!.tvl_usd), err: Math.log(comps[i]!.mcap_usd!) - pred });
  }
  return out;
}

/** P25-P75 band multipliers for a row's TVL, from the LOO errors of comps
 *  within +-1.0 of the row's ln(TVL); all comps when fewer than 10 are near. */
function localBand(lnTvl: number, loo: { lnTvl: number; err: number }[]): [number, number, number] {
  let ratios = loo
    .filter((e) => Math.abs(e.lnTvl - lnTvl) <= 1.0)
    .map((e) => Math.exp(e.err));
  if (ratios.length < 10) ratios = loo.map((e) => Math.exp(e.err));
  ratios.sort((a, b) => a - b);
  return [percentile(ratios, 25), percentile(ratios, 75), ratios.length];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const model = fitModel(snapshot, comps);
  const watchlist = new Set(snapshot.watchlist);

  // --- launch odds, fitted from the snapshot's own listing dates
  const datedRows = snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .map((p) => ({
      ageY: (ageDays(p, snapshot.as_of) ?? 365) / 365.25,
      token: !recordsNoToken(p),
      category: p.category,
    }));
  const odds: FittedOdds = fitOdds(datedRows);

  // --- audit: account for all 758 protocols
  const noToken = snapshot.protocols.filter(recordsNoToken);
  const withToken = snapshot.protocols.length - noToken.length;
  const liveWithMcap = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0,
  ).length;
  const ranked: ProtocolRow[] = [];
  const excludedByReason = new Map<string, ProtocolRow[]>();
  for (const p of noToken) {
    const reason = screenReason(p);
    if (reason === null) {
      ranked.push(p);
    } else {
      const arr = excludedByReason.get(reason) ?? [];
      arr.push(p);
      excludedByReason.set(reason, arr);
    }
  }
  // The watchlist is the floor: a watchlist protocol is ranked even when
  // our screening would leave it out. Three are: b14g and reti-pooling
  // (staking products) and saturn (a stablecoin wrapper). They are ranked
  // and named here, not silently dropped.
  const watchlistFloor: string[] = [];
  for (const p of noToken) {
    if (watchlist.has(p.slug) && screenReason(p) !== null) {
      ranked.push(p);
      watchlistFloor.push(p.slug);
    }
  }
  const excludedCount = [...excludedByReason.values()].reduce((s, a) => s + a.length, 0) - watchlistFloor.length;
  const audit: AuditCounts = {
    total: snapshot.protocols.length,
    records_no_token: noToken.length,
    records_token: withToken,
    live_with_mcap: liveWithMcap,
    token_recorded_no_mcap: withToken - liveWithMcap,
    ranked: ranked.length,
    excluded: excludedCount,
    excluded_cex: (excludedByReason.get('exchange') ?? []).length,
    excluded_bridge: (excludedByReason.get('bridge') ?? []).length,
    excluded_staking: (excludedByReason.get('staking-product') ?? []).length,
    excluded_wrapped_btc:
      (excludedByReason.get('wrapped-btc') ?? []).length,
    excluded_wrapped_stablecoin: (excludedByReason.get('wrapped-stablecoin') ?? []).length,
    excluded_versioned: (excludedByReason.get('versioned-name') ?? []).length,
    excluded_wrapped:
      (excludedByReason.get('wrapped-name') ?? []).length +
      (excludedByReason.get('exchange-product') ?? []).length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_ranked: ranked.filter((p) => watchlist.has(p.slug)).length,
    watchlist_floor: watchlistFloor,
  };

  // --- local bands from leave-one-out errors (refit at run time)
  const loo = looErrors(snapshot, comps);

  // --- score and rank every rankable protocol by EXPECTED value
  const scored = ranked
    .map((p) => {
      const parts = predictParts(p, snapshot, model);
      const conditional = Math.max(1, Math.round(Math.exp(parts.blended)));
      const prob = launchP(odds, ageDays(p, snapshot.as_of), p.category);
      const ev = Math.max(1, Math.round(conditional * prob));
      const fm = farmMath(conditional, p.tvl_usd, prob);
      const [bandLo, bandHi, bandN] = localBand(Math.log(p.tvl_usd), loo);
      return { p, conditional, prob, ev, fm, parts, bandLo, bandHi, bandN };
    })
    .sort((a, b) => b.ev - a.ev || (a.p.slug < b.p.slug ? -1 : 1));
  // enforce non-increasing expected values after rounding
  let prev = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = scored.map((s, i) => {
    const ev = Math.min(s.ev, prev);
    prev = ev;
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: ev,
      farm_steps: farmSteps(s.p, s.conditional, ev, s.prob, s.fm),
    };
  });

  const compact: CompactRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category ?? 'Unknown',
    rank: i + 1,
    implied_value_usd: Math.min(s.ev, board[i]!.implied_value_usd),
    conditional_value_usd: s.conditional,
    launch_p: Math.round(s.prob * 10000) / 10000,
    tvl_usd: s.p.tvl_usd,
    growth_7d: s.p.change_7d,
    age_days: ageDays(s.p, snapshot.as_of),
    chains: s.p.chains,
    watchlist: watchlist.has(s.p.slug),
    farmer_value_usd: Math.round(s.fm.farmerValue * 100) / 100,
    expected_farmer_value_usd: Math.round(s.fm.expectedFarmerValue * 100) / 100,
    farmers: s.fm.farmers,
    capital_usd: s.fm.capital,
    net_usd: Math.round(s.fm.net * 100) / 100,
    expected_net_usd: Math.round(s.fm.expectedNet * 100) / 100,
    usd_per_hour: Math.round(s.fm.perHour * 100) / 100,
    expected_usd_per_hour: Math.round(s.fm.expectedPerHour * 100) / 100,
    break_even_p: Math.round(s.fm.breakEven * 10000) / 10000,
    band_lo_usd: Math.max(1, Math.round(s.conditional * s.bandLo)),
    band_hi_usd: Math.max(1, Math.round(s.conditional * s.bandHi)),
    ev_band_lo_usd: Math.max(1, Math.round(s.conditional * s.bandLo * s.prob)),
    ev_band_hi_usd: Math.max(1, Math.round(s.conditional * s.bandHi * s.prob)),
    verdict: s.fm.verdict,
    rank_lo: i + 1,
    rank_hi: i + 1,
    curve_usd: Math.max(1, Math.round(Math.exp(s.parts.curve))),
    grouped_usd: Math.max(1, Math.round(Math.exp(s.parts.grouped))),
    ridge_usd: Math.max(1, Math.round(Math.exp(s.parts.ridge))),
    farm_steps: board[i]!.farm_steps,
  }));

  // --- live set: the 24 biggest traded tokens, for the comps table
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Unknown',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000,
    }));

  // --- fit scatter: one point per comp (ln TVL, ln mcap, ln fitted),
  //     for the cover chart; the line is the log-log curve itself.
  const xs = comps.map((c) => Math.log(c.tvl_usd));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const scatter = {
    points: comps
      .map((c) => {
        const parts = predictParts(c, snapshot, model);
        return {
          x: Math.round(Math.log(c.tvl_usd) * 1000) / 1000,
          y: Math.round(Math.log(c.mcap_usd!) * 1000) / 1000,
          yh: Math.round(parts.blended * 1000) / 1000,
        };
      })
      .sort((a, b) => a.x - b.x),
    line: [
      Math.round(x0 * 1000) / 1000,
      Math.round((model.curveA + model.curveS * x0) * 1000) / 1000,
      Math.round(x1 * 1000) / 1000,
      Math.round((model.curveA + model.curveS * x1) * 1000) / 1000,
    ] as [number, number, number, number],
  };

  const ridgeNames = ['lnTVL', 'growth7d', 'logAge', 'nChains', ...model.ridgeChains.map((c) => `on_${c}`)];
  const ridgeCoefs: Record<string, number> = {};
  ridgeNames.forEach((name, j) => {
    ridgeCoefs[name] = Math.round(model.ridgeBeta[j + 1]! * 10000) / 10000;
  });

  const radar: RadarData = {
    model: {
      name: MODEL_NAME,
      version: MODEL_VERSION,
      curve_a: Math.round(model.curveA * 10000) / 10000,
      curve_s: Math.round(model.curveS * 10000) / 10000,
      global_median_resid: Math.round(model.globalMedianResid * 10000) / 10000,
      group_offsets: Object.fromEntries(
        Object.entries(model.offsets).map(([g, v]) => [g, Math.round(v * 10000) / 10000]),
      ),
      group_sizes: model.groupSizes,
      ridge_lambda: RIDGE_LAMBDA,
      ridge_rounds: RIDGE_ROUNDS,
      ridge_intercept: Math.round(model.ridgeBeta[0]! * 10000) / 10000,
      ridge_coefs: ridgeCoefs,
      ridge_chains: model.ridgeChains,
      blend_grouped: BLEND_GROUPED,
      blend_ridge: BLEND_RIDGE,
      shrink_k: SHRINK_K,
      odds: {
        hazards: odds.hazards,
        edges: odds.edges,
        mults: Object.fromEntries(
          Object.entries(odds.mults).map(([k, v]) => [k, Math.round(v * 10000) / 10000]),
        ),
        loglik: odds.loglik,
        weibull: odds.weibull,
        n_dated: odds.nDated,
        n_token: odds.nToken,
        validation: ODDS_VALIDATION,
      },
      validation: VALIDATION,
      farm: {
        allocation_pct: FARM_ALLOCATION_PCT,
        tvl_per_farmer: TVL_PER_FARMER,
        farmers_min: FARMERS_MIN,
        farmers_max: FARMERS_MAX,
        gas_total_usd: GAS_TOTAL_USD,
        hours_total: HOURS_TOTAL,
        tbill_rate: TBILL_RATE,
        tbill_days: TBILL_DAYS,
        farm_net_min: FARM_NET_MIN,
        farm_per_hour_min: FARM_PER_HOUR_MIN,
        thin_net_min: THIN_NET_MIN,
        thin_per_hour_min: THIN_PER_HOUR_MIN,
      },
    },
    audit,
    board: compact,
    live,
    scatter,
    board_size: board.length,
    early_size: board.length - audit.watchlist_ranked,
    live_size: live.length,
  };
  return { board, radar };
}

/** The gate's shape checks. Returns an error string or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board has ${board.length} rows, the gate needs at least 100`;
  if (board.length > 4000) return `board has ${board.length} rows, the gate allows at most 4000`;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a bad implied value ${row.implied_value_usd}`;
    }
    if (row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} implied value exceeds the cap`;
    }
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${row.slug} implied value rises after ${board[i - 1]!.slug}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps (need 3-12)`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        return `row ${row.slug} has a farm step of ${len} chars (need 20-600)`;
      }
    }
  }
  const slugs = new Set(board.map((r) => r.slug));
  for (const w of snapshot.watchlist) {
    if (!slugs.has(w)) return `watchlist slug ${w} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: window.RADAR = {...}; — written to /output/data.js. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
