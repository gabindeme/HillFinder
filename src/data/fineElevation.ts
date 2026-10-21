/**
 * Point elevations from IGN's altimetry service, for re-measuring climbs
 * (see core/refine.ts). LiDAR HD (50 cm terrain model) first; RGE ALTI where
 * LiDAR HD has no data yet. Results are cached per climb.
 */
import type { LatLon } from '../core/types';
import { cacheGet, cacheSet, DAY } from './cache';

const URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const LIDAR = 'ign_lidar_hd_mnt_mono_wld';
const RGE = 'ign_rge_alti_wld';
/** Points per request: 2,000 take ~2.5 s; bigger batches are slower overall. */
const BATCH = 2000;
const NO_DATA_BELOW = -1000;
const MAX_AGE = 90 * DAY;

async function query(points: LatLon[], resource: string, signal?: AbortSignal): Promise<number[]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lon: points.map((p) => p.lon.toFixed(7)).join('|'),
      lat: points.map((p) => p.lat.toFixed(7)).join('|'),
      resource,
      zonly: 'true',
    }),
    signal,
  });
  if (!res.ok) throw new Error(`IGN altimetry ${res.status}`);
  const { elevations } = (await res.json()) as { elevations: number[] };
  if (elevations.length !== points.length) throw new Error('IGN altimetry: unexpected response');
  return elevations.map((e) => (e < NO_DATA_BELOW ? NaN : e));
}

export interface FineProfile {
  ele: number[];
  source: 'lidar' | 'rge';
}

/** A cache key that identifies a climb line by its ends and sample count. */
const keyOf = (line: LatLon[]) => {
  const a = line[0];
  const b = line[line.length - 1];
  return `fine:${[a.lat, a.lon, b.lat, b.lon].map((v) => v.toFixed(6)).join(',')}:${line.length}`;
};

/**
 * Fine elevations for several lines at once (batched). The result has one
 * entry per line, or null if no usable data came back for it.
 */
export async function fineProfiles(lines: LatLon[][], signal?: AbortSignal): Promise<(FineProfile | null)[]> {
  const out: (FineProfile | null)[] = new Array(lines.length).fill(null);
  const todo: number[] = [];
  await Promise.all(
    lines.map(async (line, i) => {
      const cached = await cacheGet<FineProfile>(keyOf(line), MAX_AGE);
      if (cached) out[i] = cached;
      else todo.push(i);
    }),
  );
  if (!todo.length) return out;

  // Pack whole lines into batches of up to BATCH points.
  const batches: number[][] = [[]];
  let size = 0;
  for (const i of todo) {
    if (size + lines[i].length > BATCH && batches[batches.length - 1].length) {
      batches.push([]);
      size = 0;
    }
    batches[batches.length - 1].push(i);
    size += lines[i].length;
  }

  await Promise.all(
    batches.map(async (batch) => {
      const points = batch.flatMap((i) => lines[i]);
      let lidar: number[];
      try {
        lidar = await query(points, LIDAR, signal);
      } catch {
        lidar = points.map(() => NaN);
      }
      // RGE ALTI only for lines LiDAR HD doesn't fully cover.
      let offset = 0;
      const gaps: number[] = [];
      for (const i of batch) {
        const slice = lidar.slice(offset, offset + lines[i].length);
        if (slice.some(Number.isNaN)) gaps.push(i);
        else out[i] = { ele: slice, source: 'lidar' };
        offset += lines[i].length;
      }
      if (gaps.length) {
        try {
          const rge = await query(gaps.flatMap((i) => lines[i]), RGE, signal);
          let o = 0;
          for (const i of gaps) {
            const slice = rge.slice(o, o + lines[i].length);
            o += lines[i].length;
            if (slice.filter(Number.isFinite).length >= slice.length / 2) out[i] = { ele: slice, source: 'rge' };
          }
        } catch {
          // Leave those lines coarse; they'll be retried next time.
        }
      }
      for (const i of batch) if (out[i]) await cacheSet(keyOf(lines[i]), out[i]);
    }),
  );
  return out;
}
