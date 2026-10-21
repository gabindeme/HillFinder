/**
 * Re-measuring a climb with high-resolution elevation.
 *
 * Climbs are *found* on a coarse grid (~9 m) to keep downloads small; the
 * ones a user actually looks at are then re-measured point by point from
 * IGN's LiDAR HD terrain model (50 cm). This function rebuilds a climb from
 * those values: smooth lightly, re-trim the ends, recompute every stat.
 */
import { DEFAULT_DETECT, maxGrade, trimEnds } from './climbs';
import type { Climb, Profile } from './types';

/** Light smoothing for sub-metre data: median of 3, then mean over ±1 sample (15 m). */
function smoothFine(ele: number[]): number[] {
  const n = ele.length;
  const med = ele.map((v, i) =>
    i === 0 || i === n - 1 ? v : Math.max(Math.min(ele[i - 1], v), Math.min(Math.max(ele[i - 1], v), ele[i + 1])),
  );
  return med.map((_, i) => {
    const r = Math.min(1, i, n - 1 - i);
    let sum = 0;
    for (let j = i - r; j <= i + r; j++) sum += med[j];
    return sum / (2 * r + 1);
  });
}

/**
 * Linear interpolation over missing values (NaN) and bridge/tunnel samples,
 * whose terrain elevation is the ground underneath, not the deck.
 */
function fillGaps(ele: number[], skip: Set<number>): number[] | null {
  const out = ele.map((v, i) => (skip.has(i) || !Number.isFinite(v) ? NaN : v));
  const known = out.flatMap((v, i) => (Number.isNaN(v) ? [] : [i]));
  if (known.length < 2) return null;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isNaN(out[i])) continue;
    const before = known.filter((k) => k < i).pop();
    const after = known.find((k) => k > i);
    if (before === undefined) out[i] = out[after!];
    else if (after === undefined) out[i] = out[before];
    else out[i] = out[before] + ((out[after] - out[before]) * (i - before)) / (after - before);
  }
  return out;
}

/**
 * The climb re-measured from `rawEle` (one value per profile sample, NaN where
 * the service had no data). Returns null if the data is unusable.
 */
export function refineClimb(c: Climb, rawEle: number[], source: 'lidar' | 'rge'): Climb | null {
  if (rawEle.length !== c.coords.length) return null;
  const filled = fillGaps(rawEle, new Set(c.bridged ?? []));
  if (!filled) return null;
  const ele = smoothFine(filled);
  const n = ele.length;

  // Re-trim with the same rule as detection: the finer data can move the
  // true bottom or top of the climb by a few samples.
  const profile: Profile = {
    lat: Float64Array.from(c.coords, (p) => p.lat),
    lon: Float64Array.from(c.coords, (p) => p.lon),
    dist: Float64Array.from(c.profile.dist),
    ele: Float64Array.from(ele),
    attr: new Int32Array(n),
  };
  const [s, e] = trimEnds(profile, [0, n - 1], DEFAULT_DETECT);
  if (e - s < 2) return null;

  const length = profile.dist[e] - profile.dist[s];
  const gain = ele[e] - ele[s];
  return {
    ...c,
    coords: c.coords.slice(s, e + 1),
    profile: { dist: c.profile.dist.slice(s, e + 1).map((d) => d - c.profile.dist[s]), ele: ele.slice(s, e + 1) },
    bridged: (c.bridged ?? []).filter((i) => i >= s && i <= e).map((i) => i - s),
    length,
    gain,
    avgGrade: (gain / length) * 100,
    maxGrade: maxGrade(profile.dist, profile.ele, s, e) * 100,
    startEle: ele[s],
    refined: source,
    coarseGain: c.coarseGain ?? c.gain,
  };
}

export type Reliability = 'verified' | 'ok' | 'check';

/**
 * How much to trust a profile.
 *  - 'check': something looks off; the UI asks to check on site. Either the
 *    fine and coarse measurements disagree a lot (the path likely runs along
 *    a wall, embankment or cutting that the coarse grid blurred), a road
 *    shows a gradient roads almost never have, or OSM's own incline tag
 *    disagrees with the measurement.
 *  - 'verified': re-measured with LiDAR and nothing looks off.
 *  - 'ok': coarse measurement only.
 */
export function reliability(c: Climb): { level: Reliability; reasons: ('mismatch' | 'roadTooSteep' | 'osmIncline')[] } {
  const reasons: ('mismatch' | 'roadTooSteep' | 'osmIncline')[] = [];
  if (c.refined && c.coarseGain !== undefined) {
    const diff = Math.abs(c.gain - c.coarseGain);
    if (diff > Math.max(4, 0.4 * Math.max(c.gain, c.coarseGain))) reasons.push('mismatch');
  }
  const isRoad = !['footway', 'path', 'track', 'steps', 'bridleway', 'pedestrian'].includes(c.highway);
  if (isRoad && c.stairs === 0 && c.maxGrade > 20) reasons.push('roadTooSteep');
  if (c.osmIncline !== undefined && Math.abs(c.osmIncline - c.avgGrade) > 5) reasons.push('osmIncline');
  return { level: reasons.length ? 'check' : c.refined === 'lidar' ? 'verified' : 'ok', reasons };
}
