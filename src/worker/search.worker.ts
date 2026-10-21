/// <reference lib="webworker" />
/**
 * Runs the heavy part of a search (downloads + climb detection) off the main
 * thread, so the UI stays responsive on phones.
 *
 * To make searches *feel* fast:
 *  - finished results are cached, so repeating a search is instant;
 *  - wide searches also run a quick pass within NEARBY_KM, concurrently with
 *    the full one (sharing tile downloads), and post its climbs first;
 *  - a new request aborts the previous one's downloads.
 */
import { bboxAround } from '../core/geo';
import { findCandidates } from '../core/pipeline';
import type { Climb, LatLon, OsmWay } from '../core/types';
import { cacheGet, cacheSet, DAY } from '../data/cache';
import { loadElevation, type ElevationGrid } from '../data/ignElevation';
import { fetchWays, OverpassBusyError } from '../data/overpass';
import { fetchWaysFromTiles } from '../data/vectorTiles';
import type { DataSource, SearchRequest, SearchStage, WorkerMessage } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/** Paths are fetched a bit beyond the radius so climbs starting near the edge aren't cut. */
const PATH_MARGIN = 500;
/**
 * …and elevation a bit further, since climbs can run outward from the edge.
 * Elevation is the slowest download (≈1 MB, ≈1 s per tile), so keep this tight.
 */
const ELEVATION_MARGIN = 1000;
/** Detection grid: one level coarser than the finest affordable (see loadElevation). */
const COARSEN = 1;
/** Radius of the quick first pass, km. */
const NEARBY_KM = 1.5;
/** Bump when detection inputs change, to invalidate cached results. */
const RESULTS_VERSION = 4;
const RESULTS_MAX_AGE = 7 * DAY;

/**
 * Cached results store each climb's line and profile as typed arrays: tens of
 * thousands of {lat, lon} objects take seconds to write to IndexedDB, which a
 * quick reload can interrupt. Float32 keeps ~0.5 m / 1 cm precision.
 */
type PackedClimb = Omit<Climb, 'coords' | 'profile'> & { line: Float32Array; dist: Float32Array; ele: Float32Array };

interface CachedResult {
  climbs: PackedClimb[];
  resolution: number;
}

function pack({ coords, profile, ...rest }: Climb): PackedClimb {
  const line = new Float32Array(coords.length * 2);
  coords.forEach((p, i) => {
    line[2 * i] = p.lat;
    line[2 * i + 1] = p.lon;
  });
  return { ...rest, line, dist: Float32Array.from(profile.dist), ele: Float32Array.from(profile.ele) };
}

function unpack({ line, dist, ele, ...rest }: PackedClimb): Climb {
  const coords = Array.from({ length: line.length / 2 }, (_, i) => ({ lat: line[2 * i], lon: line[2 * i + 1] }));
  return { ...rest, coords, profile: { dist: Array.from(dist), ele: Array.from(ele) } };
}

const post = (msg: WorkerMessage) => self.postMessage(msg);
let current: AbortController | null = null;

async function gather(
  origin: LatLon,
  radius: number,
  source: DataSource,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<{ ways: OsmWay[]; grid: ElevationGrid }> {
  // Paths and elevation are independent: download both at once, reporting
  // combined progress.
  let elevation = { done: 0, total: 1 };
  let paths = { done: 0, total: 1 };
  const report = () => onProgress(elevation.done + paths.done, elevation.total + paths.total);
  report();
  const pathsPromise =
    source === 'fast'
      ? fetchWaysFromTiles(
          bboxAround(origin, radius + PATH_MARGIN),
          (done, total) => {
            paths = { done, total };
            report();
          },
          signal,
        )
      : fetchWays(origin, radius + PATH_MARGIN, signal).then((w) => {
          paths = { done: 1, total: 1 };
          report();
          return w;
        });
  const [ways, grid] = await Promise.all([
    pathsPromise,
    loadElevation(
      bboxAround(origin, radius + ELEVATION_MARGIN),
      (done, total) => {
        elevation = { done, total };
        report();
      },
      signal,
      COARSEN,
    ),
  ]);
  return { ways, grid };
}

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const { id, origin, radiusKm, source, includeStairs } = e.data;
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const { signal } = controller;
  const progress = (stage: SearchStage) => (done: number, total: number) => {
    if (!signal.aborted) post({ type: 'progress', id, stage, done, total });
  };

  const key = `res:${RESULTS_VERSION}:${source}:${includeStairs ? 'stairs' : 'nostairs'}:${origin.lat.toFixed(4)}:${origin.lon.toFixed(4)}:${radiusKm}`;
  const options = { includeStairs };
  try {
    const cached = await cacheGet<CachedResult>(key, RESULTS_MAX_AGE);
    if (signal.aborted) return;
    if (cached) {
      post({ type: 'result', id, candidates: cached.climbs.map(unpack), resolution: cached.resolution, missingTiles: 0 });
      return;
    }

    const radius = radiusKm * 1000;
    let fullDone = false;
    // Progress follows the nearby pass until it's done, then the full one.
    let nearbyDone = radiusKm <= NEARBY_KM + 0.5;
    const nearby = nearbyDone
      ? Promise.resolve()
      : gather(origin, NEARBY_KM * 1000, source, signal, progress('nearby')).then((near) => {
          nearbyDone = true;
          if (signal.aborted || fullDone) return;
          const candidates = findCandidates(near.ways, near.grid.sampler, origin, NEARBY_KM * 1000, undefined, options);
          post({ type: 'partial', id, candidates, resolution: near.grid.resolution, nearbyKm: NEARBY_KM });
        });
    const fullProgress = progress('download');
    const full = gather(origin, radius, source, signal, (done, total) => {
      if (nearbyDone) fullProgress(done, total);
    });
    // Don't let a nearby-pass failure (e.g. Overpass busy) hide the full result.
    nearby.catch(() => undefined);
    const { ways, grid } = await full;
    fullDone = true;
    if (signal.aborted) return;
    const candidates = findCandidates(ways, grid.sampler, origin, radius, progress('analysis'), options);
    post({ type: 'result', id, candidates, resolution: grid.resolution, missingTiles: grid.missingTiles });
    // Only cache complete results.
    if (!grid.missingTiles) await cacheSet<CachedResult>(key, { climbs: candidates.map(pack), resolution: grid.resolution });
  } catch (err) {
    if (signal.aborted) return; // superseded by a newer search
    const code = err instanceof OverpassBusyError ? 'busy' : undefined;
    post({ type: 'error', id, code, message: err instanceof Error ? err.message : String(err) });
  }
};
