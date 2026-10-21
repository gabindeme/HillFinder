/**
 * From raw OSM ways + an elevation source to candidate climbs.
 *
 * This part is independent of the user's filters (except the radius), so it
 * runs once per search; changing filters only re-runs the cheap ranking step.
 */
import { detectClimbs, maxGrade } from './climbs';
import { annotateAccess } from './access';
import { haversine } from './geo';
import { labelUnnamed } from './naming';
import { buildStrokes, splitIntoEdges } from './graph';
import { reverseProfile, strokeProfiles } from './profile';
import { classifyWay, isRunnable } from './tags';
import type { Climb, ElevationSampler, LatLon, OsmWay, Profile, WayAttrs } from './types';

export function climbFromSpan(
  p: Profile, s: number, e: number, attrs: WayAttrs[], origin: LatLon, id: string,
): Climb {
  const coords: LatLon[] = [];
  const dist: number[] = [];
  const ele: number[] = [];
  let trail = 0, safety = 0, lit = 0, stairSamples = 0, inclineSum = 0, inclineSamples = 0;
  const names = new Set<string>();
  const highways = new Map<string, number>();
  const bridged: number[] = [];
  const stairWays = new Map<number, number | undefined>(); // way id → step_count
  for (let i = s; i <= e; i++) {
    coords.push({ lat: p.lat[i], lon: p.lon[i] });
    dist.push(p.dist[i] - p.dist[s]);
    ele.push(p.ele[i]);
    const a = attrs[p.attr[i]];
    trail += a.trail;
    safety += a.safety;
    lit += a.lit;
    if (a.name) names.add(a.name);
    highways.set(a.highway, (highways.get(a.highway) ?? 0) + 1);
    if (a.offTerrain) bridged.push(i - s);
    if (a.stairs) {
      stairSamples++;
      stairWays.set(a.wayId, a.stepCount);
    }
    if (a.incline !== undefined) {
      inclineSum += a.incline;
      inclineSamples++;
    }
  }
  const stepCounts = [...stairWays.values()];
  const n = e - s + 1;
  const length = p.dist[e] - p.dist[s];
  const gain = p.ele[e] - p.ele[s];
  return {
    id,
    coords,
    profile: { dist, ele },
    length,
    gain,
    avgGrade: (gain / length) * 100,
    maxGrade: maxGrade(p.dist, p.ele, s, e) * 100,
    startEle: p.ele[s],
    distance: haversine(origin, coords[0]),
    // Samples are evenly spaced, so plain means are length-weighted means.
    trail: trail / n,
    safety: safety / n,
    lit: lit / n,
    names: [...names],
    highway: [...highways].sort((x, y) => y[1] - x[1])[0][0],
    bridged,
    stairs: stairSamples / n,
    steps: stepCounts.length && stepCounts.every((c) => c !== undefined)
      ? stepCounts.reduce((sum, c) => sum + c!, 0)
      : undefined,
    // Only meaningful if the tag covers at least half the climb.
    osmIncline: inclineSamples >= n / 2 ? inclineSum / inclineSamples : undefined,
  };
}

export interface DetectProgress {
  (done: number, total: number): void;
}

export interface DetectOptions {
  includeStairs?: boolean;
}

export function findCandidates(
  rawWays: OsmWay[],
  sampler: ElevationSampler,
  origin: LatLon,
  radius: number,
  onProgress?: DetectProgress,
  { includeStairs = false }: DetectOptions = {},
): Climb[] {
  const ways = rawWays.filter((w) => w.geometry?.length >= 2 && isRunnable(w.tags ?? {}, includeStairs));
  const attrs = ways.map((w) => classifyWay(w.id, w.tags));
  const edges = splitIntoEdges(ways);
  const strokes = buildStrokes(edges);

  const climbs: Climb[] = [];
  strokes.forEach((stroke, si) => {
    if (si % 500 === 0) onProgress?.(si, strokes.length);
    strokeProfiles(stroke, edges, attrs, sampler).forEach((profile, pi) => {
      // Walk the line both ways: a descent one way is a climb the other.
      for (const [dir, p] of [['f', profile], ['r', reverseProfile(profile)]] as const) {
        for (const [s, e] of detectClimbs(p)) {
          // Cheap pre-filter: bottom must be roughly within the radius.
          if (haversine(origin, { lat: p.lat[s], lon: p.lon[s] }) > radius) continue;
          climbs.push(climbFromSpan(p, s, e, attrs, origin, `${si}-${pi}-${dir}-${s}`));
        }
      }
    });
  });
  onProgress?.(strokes.length, strokes.length);
  labelUnnamed(climbs, rawWays);
  annotateAccess(climbs, rawWays);
  return climbs;
}
