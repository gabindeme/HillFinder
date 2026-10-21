/** Fetching runnable ways from OpenStreetMap through the Overpass API. */
import { RUNNABLE_HIGHWAYS } from '../core/tags';
import type { LatLon, OsmWay } from '../core/types';
import { cacheGet, cacheSet, DAY } from './cache';

/**
 * Public Overpass instances. They're free and often overloaded (502/504 or
 * hanging requests), so we time-box each attempt and rotate between them.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
/** Per-attempt time limit. A 5 km query normally takes 20–40 s. */
const ATTEMPT_TIMEOUT = 90_000;
/** Full passes over the endpoint list, with a pause between passes. */
const ROUNDS = 2;
const ROUND_PAUSE = 5_000;

/** Thrown when every Overpass server failed; the UI shows a "try later" message. */
export class OverpassBusyError extends Error {
  constructor(cause: unknown) {
    super('overpass-busy', { cause });
  }
}

/** Paths change slowly; a week-old copy is fine and spares the public servers. */
const MAX_AGE = 7 * DAY;

function query(center: LatLon, radius: number): string {
  const hw = RUNNABLE_HIGHWAYS.join('|');
  const around = `around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lon.toFixed(5)}`;
  // Runnable ways, plus named parks and woods used to label unnamed climbs.
  return `[out:json][timeout:90];
(
  way(${around})[highway~"^(${hw})$"][area!=yes][foot!=no]
    [service!~"^(driveway|parking_aisle|drive-through)$"];
  way(${around})[leisure~"^(park|garden|nature_reserve)$"][name];
  way(${around})[landuse=forest][name];
  way(${around})[natural=wood][name];
);
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
  const key = `osm2:${center.lat.toFixed(3)}:${center.lon.toFixed(3)}:${r}`;
  const cached = await cacheGet<OsmWay[]>(key, MAX_AGE);
  if (cached) return cached;

  const body = new URLSearchParams({ data: query(center, r) });
  let lastError: unknown;
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) await new Promise((res) => setTimeout(res, ROUND_PAUSE * round));
    for (const url of ENDPOINTS) {
      try {
        return await attempt(url, body, key, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err;
      }
    }
  }
  throw new OverpassBusyError(lastError);
}

async function attempt(url: string, body: URLSearchParams, key: string, signal?: AbortSignal): Promise<OsmWay[]> {
  const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT);
  const res = await fetch(url, { method: 'POST', body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
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
}
