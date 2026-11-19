// Launch Radar v4 — launch odds: the probability a pre-token protocol
// issues a token within 2 years, fitted from the snapshot itself.
//
// The snapshot is current-status data: for every protocol with a listing
// date we know only whether it has a token by the snapshot date, never when
// it launched. A piecewise-constant hazard by age is the honest model for
// that shape of data: it asks, for each age bucket, how fast protocols of
// that age turn token-bearing, and it never invents a launch date.
//
//   hazard h(a):  per-year launch rate while a protocol is a years old,
//                 constant inside each bucket, fitted by maximum likelihood
//                 (coordinate ascent on the current-status log-likelihood)
//   P(launch in 2y | age a, category c) =
//                 1 - exp(-mult[c] * (H(a+2) - H(a)))
//   where H is the cumulative hazard and mult[c] is a shrunk category
//   multiplier: (events + 3) / (expected + 3), so a category with few
//   protocols stays near 1 instead of swinging on one launch.
//
// Held-out, same snapshot (research/validate.py): random 70/30 split by a
// slug hash — hit rate 68.1% against a 52.2% majority rate, Brier 0.2201
// against a 0.2515 constant-rate base. Time split at the median listing
// date — Brier 0.2786 against a 0.3176 base, but the model under-predicts
// (mean predicted 0.13, observed 0.36): the future launches faster than the
// past, and the dashboard says so. The piecewise fit beats a Weibull
// (log-likelihood -414.4 vs -416.2) by a hair, so the piecewise shape is the
// one the board uses.

export interface OddsRow {
  ageY: number;
  token: boolean;
  category: string | null;
}

export interface FittedOdds {
  hazards: number[];
  edges: number[];
  mults: Record<string, number>;
  loglik: number;
  nDated: number;
  nToken: number;
  weibull: { k: number; theta: number; loglik: number };
}

/** Age-bucket edges in years; the last bucket runs to infinity. */
export const ODDS_EDGES: number[] = [0, 0.5, 1, 2, 3, 5, Number.POSITIVE_INFINITY];
export const ODDS_FLOOR = 0.05;
export const ODDS_CAP = 5.0;
export const ODDS_SHRINK = 3;
export const ODDS_HORIZON_YEARS = 2;
/** A protocol with no listing date is treated as one year old. */
export const UNKNOWN_AGE_DAYS = 365;
const YEAR_DAYS = 365.25;

export function ageYears(ageDays: number | null): number {
  return (ageDays ?? UNKNOWN_AGE_DAYS) / YEAR_DAYS;
}

/** Cumulative hazard H(a): the area under the piecewise hazard up to age a. */
export function cumHaz(ageY: number, hazards: number[]): number {
  let h = 0;
  for (let j = 0; j < hazards.length; j++) {
    const lo = ODDS_EDGES[j]!;
    const hi = ODDS_EDGES[j + 1]!;
    h += hazards[j]! * Math.max(0, Math.min(ageY, hi) - lo);
  }
  return h;
}

function loglik(rows: OddsRow[], hazards: number[]): number {
  let ll = 0;
  for (const r of rows) {
    const h = cumHaz(r.ageY, hazards);
    ll += r.token ? Math.log(Math.max(1 - Math.exp(-h), 1e-12)) : -h;
  }
  return ll;
}

/** Coordinate ascent on the current-status log-likelihood. Deterministic:
 *  fixed start, fixed move order, stops when no move improves by 1e-9. */
function fitHazards(rows: OddsRow[]): { hazards: number[]; loglik: number } {
  const hazards = new Array(ODDS_EDGES.length - 1).fill(0.3);
  let ll = loglik(rows, hazards);
  const moves = [1.25, 1.1, 1.05, 0.95, 0.9, 0.8];
  for (let sweep = 0; sweep < 400; sweep++) {
    let improved = false;
    for (let j = 0; j < hazards.length; j++) {
      for (const f of moves) {
        const trial = [...hazards];
        trial[j] = Math.max(ODDS_FLOOR, Math.min(ODDS_CAP, trial[j]! * f));
        const v = loglik(rows, trial);
        if (v > ll + 1e-9) {
          hazards.splice(0, hazards.length, ...trial);
          ll = v;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { hazards, loglik: ll };
}

/** Shrunk category multiplier: how much faster (or slower) a category
 *  launches than the age hazard alone predicts. */
function catMults(rows: OddsRow[], hazards: number[]): Record<string, number> {
  const by = new Map<string, OddsRow[]>();
  for (const r of rows) {
    const key = r.category ?? '__null';
    const arr = by.get(key) ?? [];
    arr.push(r);
    by.set(key, arr);
  }
  const out: Record<string, number> = {};
  for (const [cat, rs] of [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const expected = rs.reduce((s, r) => s + (1 - Math.exp(-cumHaz(r.ageY, hazards))), 0);
    const events = rs.filter((r) => r.token).length;
    out[cat] = (events + ODDS_SHRINK) / (expected + ODDS_SHRINK);
  }
  return out;
}

/** Weibull cross-check on the same rows: a smooth hazard to compare
 *  against the piecewise fit. Grid-searched, deterministic. */
function fitWeibull(rows: OddsRow[]): { k: number; theta: number; loglik: number } {
  let best = { k: 1, theta: 1, loglik: -1e18 };
  for (let k = 0.3; k <= 3.001; k += 0.1) {
    for (let th = 0.5; th <= 10.001; th += 0.2) {
      let ll = 0;
      for (const r of rows) {
        const h = (r.ageY / th) ** k;
        ll += r.token ? Math.log(Math.max(1 - Math.exp(-h), 1e-12)) : -h;
      }
      if (ll > best.loglik) {
        best = { k: Math.round(k * 100) / 100, theta: Math.round(th * 10) / 10, loglik: Math.round(ll * 100) / 100 };
      }
    }
  }
  return best;
}

export function fitOdds(rows: OddsRow[]): FittedOdds {
  const { hazards, loglik: ll } = fitHazards(rows);
  return {
    hazards: hazards.map((h) => Math.round(h * 10000) / 10000),
    edges: ODDS_EDGES.slice(0, -1),
    mults: catMults(rows, hazards),
    loglik: Math.round(ll * 100) / 100,
    nDated: rows.length,
    nToken: rows.filter((r) => r.token).length,
    weibull: fitWeibull(rows),
  };
}

/** P(a protocol of this age and category launches within 2 years). */
export function launchP(odds: FittedOdds, ageDays: number | null, category: string | null): number {
  const age = ageYears(ageDays);
  const m = odds.mults[category ?? '__null'] ?? 1;
  const mass = cumHaz(age + ODDS_HORIZON_YEARS, odds.hazards) - cumHaz(age, odds.hazards);
  return 1 - Math.exp(-m * mass);
}

/** The validation numbers for the odds model, measured by
 *  research/validate.py on the sealed snapshot. They are constants here
 *  because they describe the fitted odds, not the snapshot — the fit itself
 *  runs fresh on every input. */
export const ODDS_VALIDATION = {
  random_holdout: {
    n_train: 419,
    n_test: 226,
    base_rate: 0.4779,
    majority_rate: 0.5221,
    hit_rate: 0.6814,
    brier: 0.2201,
    base_brier: 0.2515,
    mean_predicted: 0.5398,
    observed: 0.4779,
  },
  time_holdout: {
    n_train: 324,
    n_test: 321,
    cut: '2025-01-06',
    base_rate: 0.3583,
    majority_rate: 0.6417,
    hit_rate: 0.6417,
    brier: 0.2786,
    base_brier: 0.3176,
    mean_predicted: 0.1292,
    observed: 0.3583,
  },
};
