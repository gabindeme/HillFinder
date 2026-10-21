/**
 * "Fast" path source: OpenStreetMap data from OpenFreeMap vector tiles
 * (OpenMapTiles schema, z14), served from a CDN with no API key.
 *
 * Compared with Overpass it's much faster and more reliable, but the tiles
 * are a cartographic product, so we rebuild routable ways from them:
 *  - lines of identical attributes are merged across OSM ways, and street
 *    names live in a separate layer: we re-attach names by matching vertices;
 *  - features extend into a 64-unit buffer around each tile: we clip to the
 *    tile so neighbouring tiles join exactly at the boundary;
 *  - there are no node ids: vertices get ids from their global integer tile
 *    coordinates, which coincide wherever OSM ways share a node.
 * There is no `lit` tag in the schema, so lighting is unknown in this mode.
 */
import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { BBox, OsmWay, Tags } from '../core/types';
import { cacheGet, cacheSet, DAY } from './cache';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;
const EXTENT = 4096;
const CONCURRENCY = 8;
const MAX_AGE = 14 * DAY;

/** Global integer coordinate space: tile index × extent + position in tile. */
const WORLD = 2 ** Z * EXTENT;

export function lonToTileX(lon: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** Z);
}

export function latToTileY(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
}

function globalToLatLon(gx: number, gy: number) {
  const lon = (gx / WORLD) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * gy) / WORLD;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon };
}

type Pt = [number, number];

/**
 * Clips a polyline to the square [0, EXTENT]², returning the pieces inside.
 * Works in global coordinates so that a boundary crossing computed from two
 * neighbouring tiles lands on exactly the same point.
 */
export function clipLine(line: Pt[], minX: number, minY: number, size: number): Pt[][] {
  const maxX = minX + size;
  const maxY = minY + size;
  const out: Pt[][] = [];
  let current: Pt[] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (i > 0) {
      const a = line[i - 1];
      // Liang–Barsky: parametric clip of segment a→p against the box.
      let t0 = 0;
      let t1 = 1;
      const dx = p[0] - a[0];
      const dy = p[1] - a[1];
      const edges: [number, number][] = [
        [-dx, a[0] - minX], [dx, maxX - a[0]], [-dy, a[1] - minY], [dy, maxY - a[1]],
      ];
      let visible = true;
      for (const [pe, qe] of edges) {
        if (pe === 0) {
          if (qe < 0) visible = false;
        } else {
          const r = qe / pe;
          if (pe < 0) t0 = Math.max(t0, r);
          else t1 = Math.min(t1, r);
        }
      }
      if (visible && t0 <= t1) {
        const s: Pt = [Math.round(a[0] + t0 * dx), Math.round(a[1] + t0 * dy)];
        const e: Pt = [Math.round(a[0] + t1 * dx), Math.round(a[1] + t1 * dy)];
        if (!current.length) current.push(s);
        current.push(e);
        // Leaving the box ends this piece.
        if (t1 < 1) {
          out.push(current);
          current = [];
        }
      } else if (current.length) {
        out.push(current);
        current = [];
      }
    }
  }
  if (current.length) out.push(current);
  // Drop consecutive duplicates (rounding) and degenerate pieces.
  return out
    .map((piece) => piece.filter((q, i) => i === 0 || q[0] !== piece[i - 1][0] || q[1] !== piece[i - 1][1]))
    .filter((piece) => piece.length >= 2);
}

const SKIP_SUBCLASS = new Set(['steps', 'platform', 'corridor', 'elevator', 'escalator']);
const SKIP_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through']);

/** OpenMapTiles transportation attributes → OSM-like tags (see tags.ts). */
export function omtTags(p: Record<string, unknown>): Tags | null {
  const cls = String(p.class ?? '');
  const sub = p.subclass ? String(p.subclass) : '';
  let highway: string;
  switch (cls) {
    case 'primary':
    case 'secondary':
    case 'tertiary':
    case 'track':
      highway = cls;
      break;
    case 'minor':
      highway = 'residential';
      break;
    case 'service':
      if (p.service && SKIP_SERVICE.has(String(p.service))) return null;
      highway = 'service';
      break;
    case 'path':
      if (!sub || SKIP_SUBCLASS.has(sub)) return null;
      highway = sub;
      break;
    default:
      return null; // motorways, rail, ferries, piers, …
  }
  const tags: Tags = { highway };
  if (p.surface) tags.surface = String(p.surface); // 'paved' | 'unpaved'
  if (p.access) tags.access = String(p.access);
  if (p.foot) tags.foot = String(p.foot);
  if (p.service) tags.service = String(p.service);
  if (p.brunnel === 'bridge') tags.bridge = 'yes';
  if (p.brunnel === 'tunnel') tags.tunnel = 'yes';
  return tags;
}

/** Ring signed area in tile coordinates (y down): outer rings are positive. */
function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

let nextId = 1;

/** Converts one decoded tile into ways (paths + named park outlines). */
export function tileToWays(tile: VectorTile, tx: number, ty: number): OsmWay[] {
  const ox = tx * EXTENT;
  const oy = ty * EXTENT;
  const g = (p: { x: number; y: number }): Pt => [ox + p.x, oy + p.y];
  const nodeId = ([x, y]: Pt) => x * WORLD + y; // < 2^53, so exact
  const ways: OsmWay[] = [];

  // Street names by vertex. A junction vertex carries the names of every
  // street through it, so a segment is named after the street common to both
  // of its ends.
  const names = new Map<number, Set<string>>();
  const tn = tile.layers.transportation_name;
  for (let i = 0; i < (tn?.length ?? 0); i++) {
    const f = tn.feature(i);
    if (!f.properties.name) continue;
    const name = String(f.properties.name);
    for (const part of f.loadGeometry()) {
      for (const p of part) {
        const id = nodeId(g(p));
        const set = names.get(id);
        if (set) set.add(name);
        else names.set(id, new Set([name]));
      }
    }
  }
  const segmentName = (a: Pt, b: Pt): string | undefined => {
    const na = names.get(nodeId(a));
    const nb = names.get(nodeId(b));
    if (!na || !nb) return undefined;
    for (const n of na) if (nb.has(n)) return n;
    return undefined;
  };

  const tr = tile.layers.transportation;
  for (let i = 0; i < (tr?.length ?? 0); i++) {
    const f: VectorTileFeature = tr.feature(i);
    if (f.type !== 2) continue; // lines only
    const tags = omtTags(f.properties);
    if (!tags) continue;
    for (const part of f.loadGeometry()) {
      for (const piece of clipLine(part.map(g), ox, oy, EXTENT)) {
        // Split where the street name changes; unmatched segments keep the current name.
        let run: Pt[] = [piece[0]];
        let runName: string | null = null;
        const flush = () => {
          if (run.length < 2) return;
          ways.push({
            id: nextId++,
            nodes: run.map(nodeId),
            geometry: run.map(([x, y]) => globalToLatLon(x, y)),
            tags: runName ? { ...tags, name: runName } : tags,
          });
        };
        for (let k = 1; k < piece.length; k++) {
          const name = segmentName(piece[k - 1], piece[k]);
          if (name !== undefined && runName !== null && name !== runName) {
            flush();
            run = [piece[k - 1]]; // the shared vertex joins both runs
          }
          if (name !== undefined) runName = name;
          run.push(piece[k]);
        }
        flush();
      }
    }
  }

  // Named parks, used only to label unnamed climbs ("Footpath in Parc du Thabor").
  const park = tile.layers.park;
  for (let i = 0; i < (park?.length ?? 0); i++) {
    const f = park.feature(i);
    if (f.type !== 3 || !f.properties.name) continue;
    for (const ring of f.loadGeometry()) {
      const pts = ring.map(g);
      if (pts.length < 4 || ringArea(pts) <= 0) continue; // skip holes
      ways.push({
        id: -nextId++,
        nodes: [],
        geometry: pts.map(([x, y]) => globalToLatLon(x, y)),
        tags: { leisure: 'park', name: String(f.properties.name) },
      });
    }
  }
  return ways;
}

async function tileUrlTemplate(): Promise<string> {
  const cached = await cacheGet<string>('omt:template', DAY);
  if (cached) return cached;
  const res = await fetch(TILEJSON);
  if (!res.ok) throw new Error(`OpenFreeMap ${res.status}`);
  const template = ((await res.json()) as { tiles: string[] }).tiles[0];
  await cacheSet('omt:template', template);
  return template;
}

async function fetchTile(template: string, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const url = template.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y));
  const key = `omt:${url}`;
  const cached = await cacheGet<ArrayBuffer>(key, MAX_AGE);
  if (cached) return cached;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal });
      // 204/404: no data here (e.g. sea).
      if (res.status === 204 || res.status === 404) return new ArrayBuffer(0);
      if (!res.ok) throw new Error(`OpenFreeMap ${res.status}`);
      const buf = await res.arrayBuffer();
      await cacheSet(key, buf);
      return buf;
    } catch (err) {
      if (signal?.aborted || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

export async function fetchWaysFromTiles(
  bbox: BBox,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<OsmWay[]> {
  const template = await tileUrlTemplate();
  const jobs: [number, number][] = [];
  for (let x = lonToTileX(bbox.west); x <= lonToTileX(bbox.east); x++) {
    for (let y = latToTileY(bbox.north); y <= latToTileY(bbox.south); y++) jobs.push([x, y]);
  }
  const ways: OsmWay[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [x, y] = jobs[next++];
      const buf = await fetchTile(template, x, y, signal);
      if (buf.byteLength) ways.push(...tileToWays(new VectorTile(new PbfReader(new Uint8Array(buf))), x, y));
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return ways;
}
