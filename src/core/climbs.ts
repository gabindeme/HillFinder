/**
 * Climb detection on an elevation profile.
 *
 * A "climb" is a stretch that goes up overall, where:
 *  - short dips are tolerated (a 1 m dip shouldn't end a 40 m climb), but a
 *    dip deeper than `dipTolerance` ends it;
 *  - long flat or very gentle stretches split it (two ramps joined by a 300 m
 *    flat are two hills for repeat purposes, not one 1% "climb");
 *  - gentle run-ins and run-outs at either end are trimmed, so stats describe
 *    the actual hill.
 *
 * Detection is deliberately permissive (a few metres of gain is enough):
 * user filters and scoring decide what's worth showing. That's what lets the
 * app find "the best of what's there" even in very flat places.
 */
import type { Profile } from './types';

export interface DetectParams {
  /** A drop below the running peak greater than this ends the climb (m). */
  dipTolerance: number;
  /** A stretch at least this long (m)… */
  flatLength: number;
  /** …with average grade below this (fraction) splits a climb. */
  flatGrade: number;
  /** Ends are trimmed while the grade over `trimWindow` is below this (fraction). */
  trimGrade: number;
  trimWindow: number;
  minLength: number;
  minGain: number;
}

export const DEFAULT_DETECT: DetectParams = {
  dipTolerance: 2,
  flatLength: 100,
  flatGrade: 0.01,
  trimGrade: 0.015,
  trimWindow: 20,
  minLength: 50,
  minGain: 3,
};

/** [start, end] sample indices, inclusive, with end higher than start. */
export type Span = [number, number];

/**
 * Pass 1: hysteresis scan. Track the lowest start and running peak; once we
 * fall more than `dipTolerance` below the peak, the climb is over and we
 * restart from the lowest point reached since that peak.
 */
export function scanAscents(ele: ArrayLike<number>, dipTolerance: number): Span[] {
  const spans: Span[] = [];
  const n = ele.length;
  let s = 0; // climb start (lowest point)
  let p = 0; // running peak
  let m = 0; // lowest point since the peak
  for (let i = 1; i < n; i++) {
    if (ele[i] < ele[s]) {
      // Fell below the start: anything before was too small to count, unless
      // it already exceeded the tolerance (handled below on earlier samples).
      if (p > s && ele[p] - ele[s] > dipTolerance) spans.push([s, p]);
      s = p = m = i;
      continue;
    }
    if (ele[i] >= ele[p]) {
      p = m = i;
      continue;
    }
    if (ele[i] < ele[m]) m = i;
    if (ele[p] - ele[i] > dipTolerance) {
      if (p > s) spans.push([s, p]);
      s = p = m;
      // Re-scan from m: samples between m and i may already be climbing again.
      i = m;
    }
  }
  if (p > s) spans.push([s, p]);
  return spans;
}

/** Index of the first sample at least `len` metres after i (or n - 1). */
function ahead(dist: ArrayLike<number>, i: number, len: number, limit: number): number {
  let j = i;
  while (j < limit && dist[j] - dist[i] < len) j++;
  return j;
}

/**
 * Pass 2: split a span at long gentle stretches. We look for windows of at
 * least `flatLength` with grade below `flatGrade`, merge overlapping ones, and
 * keep the pieces in between.
 */
export function splitAtFlats(p: Profile, [s, e]: Span, params: DetectParams): Span[] {
  const { dist, ele } = p;
  const out: Span[] = [];
  let pieceStart = s;
  let i = s;
  while (i < e) {
    const j = ahead(dist, i, params.flatLength, e);
    const len = dist[j] - dist[i];
    if (len >= params.flatLength && (ele[j] - ele[i]) / len < params.flatGrade) {
      // Extend the flat window as far as it stays flat.
      let k = j;
      while (k < e) {
        const k2 = k + 1;
        if ((ele[k2] - ele[i]) / (dist[k2] - dist[i]) >= params.flatGrade) break;
        k = k2;
      }
      if (i > pieceStart) out.push([pieceStart, i]);
      pieceStart = k;
      i = k;
    } else {
      i++;
    }
  }
  if (e > pieceStart) out.push([pieceStart, e]);
  return out;
}

/**
 * Pass 3: trim gentle ends. We stop trimming only where both the next sample
 * step and the next `trimWindow` metres are steep enough: the window alone
 * would stop as soon as it overlaps the ramp, leaving flat bits in the climb;
 * the step alone could stop on a single noisy sample.
 */
export function trimEnds(p: Profile, [s, e]: Span, params: DetectParams): Span {
  const { dist, ele } = p;
  const grade = (a: number, b: number) => (ele[b] - ele[a]) / Math.max(1e-6, dist[b] - dist[a]);
  while (s < e) {
    const j = ahead(dist, s, params.trimWindow, e);
    if (grade(s, j) >= params.trimGrade && grade(s, s + 1) >= params.trimGrade) break;
    s++;
  }
  while (e > s) {
    let j = e;
    while (j > s && dist[e] - dist[j] < params.trimWindow) j--;
    if (grade(j, e) >= params.trimGrade && grade(e - 1, e) >= params.trimGrade) break;
    e--;
  }
  return [s, e];
}

/** All climbs on a profile (in its walking direction). */
export function detectClimbs(p: Profile, params: DetectParams = DEFAULT_DETECT): Span[] {
  const result: Span[] = [];
  for (const span of scanAscents(p.ele, params.dipTolerance)) {
    for (const piece of splitAtFlats(p, span, params)) {
      const [s, e] = trimEnds(p, piece, params);
      if (p.dist[e] - p.dist[s] >= params.minLength && p.ele[e] - p.ele[s] >= params.minGain) {
        result.push([s, e]);
      }
    }
  }
  return result;
}

/**
 * Steepest sustained grade: max grade over any window of `window` metres
 * (or the whole climb if shorter). Using a window rather than sample-to-sample
 * differences keeps one noisy metre from claiming "28% max".
 */
export function maxGrade(dist: ArrayLike<number>, ele: ArrayLike<number>, s: number, e: number, window = 50): number {
  const w = Math.min(window, dist[e] - dist[s]);
  let best = 0;
  let j = s;
  for (let i = s; i <= e; i++) {
    while (j < e && dist[j] - dist[i] < w) j++;
    if (dist[j] - dist[i] < w) break;
    best = Math.max(best, (ele[j] - ele[i]) / (dist[j] - dist[i]));
  }
  return best;
}
