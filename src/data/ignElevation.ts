/**
 * Terrain elevation from IGN's RGE ALTI (lidar-based, 1 m native resolution,
 * France only), via the free Géoplateforme WMS-Raster service.
 *
 * We request raw float32 grids (`image/x-bil;bits=32`) on a fixed global tile
 * grid in EPSG:4326, so tiles are reusable across searches and cacheable.
 * Elevation along paths is then sampled locally with bilinear interpolation,
 * which avoids one network call per point.
 *
 * Tile level L covers 0.02·2^L° of latitude by 0.03·2^L° of longitude
 * (≈ 2.2 km square at Rennes' latitude for L = 0) at 512 × 512 px, i.e. about
 * 4.3 m per pixel at L = 0. Larger search areas use coarser levels to keep the
 * number of downloads reasonable.
 */
import type { BBox, ElevationSampler } from '../core/types';
import { cacheGet, cacheSet, DAY } from './cache';

const WMS = 'https://data.geopf.fr/wms-r/wms';
const LAYER = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
const SIZE = 512;
const BASE_LAT = 0.02;
const BASE_LON = 0.03;
/** Most tiles we're willing to download for one search. */
const MAX_TILES = 49;
/** The service takes ~0.7 s to render a tile; 8 in parallel measured ~1.6× faster than 4. */
const CONCURRENCY = 8;
/** IGN marks cells without data (sea, outside France) with this value. */
const NO_DATA_BELOW = -1000;
/** Terrain doesn't change; keep tiles for a long time. */
const MAX_AGE = 90 * DAY;

interface Tile {
  level: number;
  tx: number;
  ty: number;
  data: Float32Array;
}

const spans = (level: number) => ({ lat: BASE_LAT * 2 ** level, lon: BASE_LON * 2 ** level });

function tilesFor(bbox: BBox, level: number) {
  const s = spans(level);
  const out: { tx: number; ty: number }[] = [];
  for (let ty = Math.floor(bbox.south / s.lat); ty <= Math.floor(bbox.north / s.lat); ty++) {
    for (let tx = Math.floor(bbox.west / s.lon); tx <= Math.floor(bbox.east / s.lon); tx++) {
      out.push({ tx, ty });
    }
  }
  return out;
}

/** Finest level that covers the bbox in at most MAX_TILES tiles. */
export function chooseLevel(bbox: BBox): number {
  let level = 0;
  while (tilesFor(bbox, level).length > MAX_TILES) level++;
  return level;
}

export function metresPerPixel(level: number): number {
  return (spans(level).lat * 111_320) / SIZE;
}

/**
 * Downloads in progress, by cache key: the nearby and full search passes run
 * concurrently and ask for the same centre tiles; they share one request.
 */
const inFlight = new Map<string, Promise<Tile>>();

function fetchTile(level: number, tx: number, ty: number, signal?: AbortSignal): Promise<Tile> {
  const key = `ign:${level}:${tx}:${ty}`;
  let p = inFlight.get(key);
  if (!p) {
    p = fetchTileUncached(key, level, tx, ty, signal).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return p;
}

async function fetchTileUncached(key: string, level: number, tx: number, ty: number, signal?: AbortSignal): Promise<Tile> {
  const cached = await cacheGet<ArrayBuffer>(key, MAX_AGE);
  if (cached) return { level, tx, ty, data: new Float32Array(cached) };

  const s = spans(level);
  const south = ty * s.lat;
  const west = tx * s.lon;
  // WMS 1.3.0 with EPSG:4326 uses lat,lon axis order in BBOX.
  const params = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: LAYER, STYLES: '', CRS: 'EPSG:4326',
    BBOX: [south, west, south + s.lat, west + s.lon].map((v) => v.toFixed(6)).join(','),
    WIDTH: String(SIZE), HEIGHT: String(SIZE), FORMAT: 'image/x-bil;bits=32',
  });
  const buf = await fetchWithRetry(`${WMS}?${params}`, signal);
  await cacheSet(key, buf);
  // BIL from this service is little-endian float32, rows from north to south.
  return { level, tx, ty, data: new Float32Array(buf) };
}

/**
 * The service occasionally answers 400/429/5xx under load (seen in testing),
 * so retry a few times with backoff before giving up on a tile.
 */
async function fetchWithRetry(url: string, signal?: AbortSignal, attempts = 3): Promise<ArrayBuffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`IGN elevation ${res.status}`);
      const buf = await res.arrayBuffer();
      // Errors sometimes come back as a 200 XML document instead of the grid.
      if (buf.byteLength !== SIZE * SIZE * 4) throw new Error('IGN elevation: unexpected response');
      return buf;
    } catch (err) {
      if (signal?.aborted || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
    }
  }
}

/** Run async jobs with bounded concurrency, reporting progress. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number, onDone?: (n: number) => void): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

export interface ElevationGrid {
  sampler: ElevationSampler;
  level: number;
  resolution: number;
  /** Tiles that still failed after retries; their area has no elevation. */
  missingTiles: number;
}

export async function loadElevation(
  bbox: BBox,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ElevationGrid> {
  const level = chooseLevel(bbox);
  const s0 = spans(level);
  const cLat = (bbox.south + bbox.north) / 2;
  const cLon = (bbox.west + bbox.east) / 2;
  // Centre tiles first: they matter most, and a quick first pass reuses them.
  const wanted = tilesFor(bbox, level).sort(
    (a, b) =>
      Math.hypot((a.tx + 0.5) * s0.lon - cLon, (a.ty + 0.5) * s0.lat - cLat) -
      Math.hypot((b.tx + 0.5) * s0.lon - cLon, (b.ty + 0.5) * s0.lat - cLat),
  );
  // A failed tile shouldn't sink the whole search: climbs elsewhere are still valid.
  const results = await pool(
    wanted.map(({ tx, ty }) => () => fetchTile(level, tx, ty, signal).catch((err: unknown) => err as Error)),
    CONCURRENCY,
    (n) => onProgress?.(n, wanted.length),
  );
  const tiles = results.filter((r): r is Tile => !(r instanceof Error));
  if (!tiles.length) throw results[0] as Error;
  const byKey = new Map(tiles.map((t) => [`${t.tx}:${t.ty}`, t]));
  const s = spans(level);

  const sampler: ElevationSampler = (lat, lon) => {
    const tx = Math.floor(lon / s.lon);
    const ty = Math.floor(lat / s.lat);
    const tile = byKey.get(`${tx}:${ty}`);
    if (!tile) return null;
    // Fractional pixel coordinates, relative to pixel centres.
    const col = ((lon - tx * s.lon) / s.lon) * SIZE - 0.5;
    const row = ((ty * s.lat + s.lat - lat) / s.lat) * SIZE - 0.5;
    // Clamp at tile borders (half a pixel of error at most).
    const c0 = Math.max(0, Math.min(SIZE - 2, Math.floor(col)));
    const r0 = Math.max(0, Math.min(SIZE - 2, Math.floor(row)));
    const fc = Math.max(0, Math.min(1, col - c0));
    const fr = Math.max(0, Math.min(1, row - r0));
    const d = tile.data;
    const i = r0 * SIZE + c0;
    const v00 = d[i], v01 = d[i + 1], v10 = d[i + SIZE], v11 = d[i + SIZE + 1];
    if (v00 < NO_DATA_BELOW || v01 < NO_DATA_BELOW || v10 < NO_DATA_BELOW || v11 < NO_DATA_BELOW) return null;
    return (v00 * (1 - fc) + v01 * fc) * (1 - fr) + (v10 * (1 - fc) + v11 * fc) * fr;
  };

  return { sampler, level, resolution: metresPerPixel(level), missingTiles: results.length - tiles.length };
}
