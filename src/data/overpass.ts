/** Fetching runnable ways from OpenStreetMap through the Overpass API. */
import { RUNNABLE_HIGHWAYS } from '../core/tags';
import type { LatLon, OsmWay } from '../core/types';
import { cacheGet, cacheSet, DAY } from './cache';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

/** Paths change slowly; a week-old copy is fine and spares the public servers. */
const MAX_AGE = 7 * DAY;

function query(center: LatLon, radius: number): string {
  const hw = RUNNABLE_HIGHWAYS.join('|');
  return `[out:json][timeout:90];
way(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lon.toFixed(5)})
  [highway~"^(${hw})$"][area!=yes][foot!=no]
  [service!~"^(driveway|parking_aisle|drive-through)$"];
out body geom qt;`;
}

interface OverpassElement {
  type: string;
  id: number;
  nodes?: number[];
  geometry?: LatLon[];
  tags?: Record<string, string>;
}

export async function fetchWays(center: LatLon, radius: number, signal?: AbortSignal): Promise<OsmWay[]> {
  // Round the centre and radius so small moves of the origin reuse the same download.
  const r = Math.ceil(radius / 500) * 500;
  const key = `osm:${center.lat.toFixed(3)}:${center.lon.toFixed(3)}:${r}`;
  const cached = await cacheGet<OsmWay[]>(key, MAX_AGE);
  if (cached) return cached;

  const body = new URLSearchParams({ data: query(center, r) });
  let lastError: unknown;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements: OverpassElement[] };
      const ways: OsmWay[] = json.elements
        .filter((e) => e.type === 'way' && e.nodes && e.geometry)
        .map((e) => ({
          id: e.id,
          nodes: e.nodes!,
          // Overpass adds extra fields; keep only what we use.
          geometry: e.geometry!.map((g) => ({ lat: g.lat, lon: g.lon })),
          tags: e.tags ?? {},
        }));
      await cacheSet(key, ways);
      return ways;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
