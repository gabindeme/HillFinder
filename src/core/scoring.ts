/**
 * Ranking climbs.
 *
 * Each climb gets factor values in [0, 1], which are combined with weights
 * that depend on the user's ranking priority. The breakdown is returned so the
 * UI can show exactly why a hill ranks where it does.
 *
 * Steepness, gain and length are normalised *relative to the candidates
 * found* (against their 90th percentile), not against absolute mountain
 * standards. In Rennes the best hill may have 35 m of gain; it should still
 * score near the top rather than "3/100 compared to the Alps". The 90th
 * percentile (rather than the max) stops a single outlier from squashing
 * everyone else's score.
 */
import { isAccessible } from './access';
import { dedupe } from './dedupe';
import { BUSY_ROAD_SAFETY, effectiveRadiusKm, type Filters, type Priority } from './filters';
import type { Climb } from './types';

export type FactorKey = 'steepness' | 'gain' | 'length' | 'proximity' | 'trail' | 'safety' | 'lit';

export interface Factor {
  key: FactorKey;
  /** Normalised factor value, 0..1. */
  value: number;
  /** Weight share (weights sum to 1). */
  weight: number;
  /** value × weight × 100: points this factor contributes to the score. */
  points: number;
}

export interface RankedClimb extends Climb {
  rank: number;
  /** 0..100 */
  score: number;
  factors: Factor[];
}

type Weights = Record<FactorKey, number>;

const BASE_WEIGHTS: Record<Priority, Omit<Weights, 'lit'>> = {
  balanced: { steepness: 0.25, gain: 0.3, length: 0.1, proximity: 0.15, trail: 0.05, safety: 0.15 },
  steepest: { steepness: 0.6, gain: 0.15, length: 0.0, proximity: 0.1, trail: 0.05, safety: 0.1 },
  longest: { steepness: 0.1, gain: 0.15, length: 0.55, proximity: 0.1, trail: 0.0, safety: 0.1 },
  gain: { steepness: 0.15, gain: 0.6, length: 0.05, proximity: 0.1, trail: 0.0, safety: 0.1 },
  closest: { steepness: 0.15, gain: 0.15, length: 0.05, proximity: 0.55, trail: 0.0, safety: 0.1 },
  trail: { steepness: 0.15, gain: 0.15, length: 0.05, proximity: 0.1, trail: 0.5, safety: 0.05 },
};

export function weightsFor(filters: Filters): Weights {
  const w: Weights = { ...BASE_WEIGHTS[filters.priority], lit: 0 };
  if (filters.avoidTraffic) w.safety += 0.15;
  if (filters.preferLit) w.lit = 0.15;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(w) as FactorKey[]) w[k] /= total;
  return w;
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Mostly stairs (only present when the "include stairs" option is on). */
export const isStairs = (c: Climb) => (c.stairs ?? 0) >= 0.5;

/**
 * Stairs climb 4–10 m in a flat city; the hill "minimum gain" would hide them
 * all. They need this much height (~25 steps), or the user's minimum if lower.
 */
const STAIRS_MIN_GAIN = 4;
/** With stairs on, the best few are always listed (hills would outscore them). */
const STAIRS_SLOTS = 5;

export function scoreClimbs(climbs: Climb[], filters: Filters): RankedClimb[] {
  const weights = weightsFor(filters);
  // Floors keep the scale meaningful when every candidate is tiny.
  // Stairs (30–60%) would stretch the steepness scale and flatten every hill's score.
  const refGrade = Math.max(3, percentile(climbs.filter((c) => !isStairs(c)).map((c) => c.avgGrade), 0.9));
  const refGain = Math.max(10, percentile(climbs.map((c) => c.gain), 0.9));
  const refLength = Math.max(200, percentile(climbs.map((c) => c.length), 0.9));
  const radius = effectiveRadiusKm(filters) * 1000;

  return climbs.map((c) => {
    const values: Record<FactorKey, number> = {
      steepness: clamp01(c.avgGrade / refGrade),
      gain: clamp01(c.gain / refGain),
      length: clamp01(c.length / refLength),
      proximity: clamp01(1 - c.distance / radius),
      trail: c.trail,
      safety: c.safety,
      lit: c.lit,
    };
    const factors = (Object.keys(values) as FactorKey[])
      .filter((k) => weights[k] > 0)
      .map((key) => ({ key, value: values[key], weight: weights[key], points: values[key] * weights[key] * 100 }));
    const score = factors.reduce((s, f) => s + f.points, 0);
    return { ...c, rank: 0, score, factors };
  });
}

/** Hard filters, as a predicate. */
export function passes(c: Climb, f: Filters): boolean {
  if (c.distance > effectiveRadiusKm(f) * 1000) return false;
  // Stair flights are short (30–60 m); for them the height climbed is what counts.
  if ((!isStairs(c) && c.length < f.minLength) || c.length > f.maxLength) return false;
  if (c.gain < (isStairs(c) ? Math.min(f.minGain, STAIRS_MIN_GAIN) : f.minGain)) return false;
  // Gradient limits are about runnable slopes; stairs are steep by nature.
  if (!isStairs(c) && (c.avgGrade < f.minAvgGrade || c.avgGrade > f.maxAvgGrade)) return false;
  if (!isStairs(c) && f.maxGrade !== null && c.maxGrade > f.maxGrade) return false;
  if (f.surface === 'trail' && c.trail < 0.5) return false;
  if (f.surface === 'road' && c.trail > 0.5) return false;
  if (f.avoidTraffic && c.safety < BUSY_ROAD_SAFETY) return false;
  if (f.openAllTimes && c.access?.hours) return false;
  return true;
}

/**
 * Progressively looser versions of the user's filters. Used so we always
 * return the best available hills instead of "no results" in flat areas.
 * The radius is never relaxed: we never send people further than they asked.
 */
function relaxations(f: Filters): Filters[] {
  return [
    f,
    {
      ...f,
      minGain: f.minGain / 2,
      minAvgGrade: f.minAvgGrade / 2,
      minLength: f.minLength / 2,
      maxLength: f.maxLength * 2,
    },
    {
      ...f,
      minGain: 0,
      minAvgGrade: 0,
      minLength: 0,
      maxLength: Infinity,
      maxAvgGrade: Infinity,
      maxGrade: null,
      surface: 'any',
      avoidTraffic: false,
      openAllTimes: false,
    },
  ];
}

export const MIN_RESULTS = 3;
export const MAX_RESULTS = 20;

export interface RankResult {
  climbs: RankedClimb[];
  /** 0 = user filters as set; >0 = filters had to be loosened. */
  relaxLevel: number;
  /** Climbs within the area hidden because they aren't publicly accessible. */
  hiddenRestricted: number;
}

export function rankClimbs(all: Climb[], filters: Filters): RankResult {
  // Access restrictions are never relaxed: we don't send people onto military
  // bases or through locked gates just to have something to show.
  const radius = effectiveRadiusKm(filters) * 1000;
  const candidates = all.filter(isAccessible);
  const hiddenRestricted = dedupe(
    all.filter((c) => !isAccessible(c) && c.distance <= radius).sort((a, b) => b.gain - a.gain),
  ).length;
  const levels = relaxations(filters);
  let best: RankResult = { climbs: [], relaxLevel: 0, hiddenRestricted };
  for (let level = 0; level < levels.length; level++) {
    const kept = candidates.filter((c) => passes(c, levels[level]));
    // Score against the original filters' weights; only the gates are relaxed.
    const scored = scoreClimbs(kept, filters).sort((a, b) => b.score - a.score);
    // Hills and stairs are listed separately, then merged by score.
    const hills = dedupe(scored.filter((c) => !isStairs(c)), MAX_RESULTS);
    const stairs = dedupe(scored.filter(isStairs), STAIRS_SLOTS);
    const unique = [...hills, ...stairs].sort((a, b) => b.score - a.score);
    unique.forEach((c, i) => (c.rank = i + 1));
    best = { climbs: unique, relaxLevel: level, hiddenRestricted };
    if (unique.length >= MIN_RESULTS) break;
  }
  return best;
}
