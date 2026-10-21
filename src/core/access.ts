/**
 * Is a climb publicly accessible, and at all times?
 *
 * Path tags alone aren't enough: roads inside a military base or school
 * grounds are often mapped without any access tag, because the restriction
 * is on the surrounding area. So we also check, from OSM data:
 *  - restricted areas the climb lies in (military, prison, school, private);
 *  - opening hours of the park it's in (many city parks close at night);
 *  - locked or private gates along it.
 * Area and gate features arrive as pseudo-ways next to the paths (see
 * overpass.ts / vectorTiles.ts). This is only as good as the map: the UI
 * reminds users that signs on site take precedence.
 */
import { localProjection } from './geo';
import type { Climb, LatLon, OsmWay, Tags } from './types';

export type Restriction = 'military' | 'prison' | 'school' | 'private';

export interface Access {
  /** Set when a meaningful part of the climb is inside a restricted area. */
  restricted?: Restriction;
  /** Raw OSM opening_hours of the park the climb is in, when not 24/7. */
  hours?: string;
  /** The climb passes a locked or private gate. */
  closedGate?: boolean;
}

/** Share of a climb inside a restricted area above which we hide it. */
const RESTRICTED_SHARE = 0.2;
/** A gate this close to the climb line is considered on it, metres. */
const GATE_DISTANCE = 4;

export function restrictionOf(tags: Tags): Restriction | null {
  if (tags.highway) return null;
  if (tags.landuse === 'military' || (tags.military && tags.military !== 'no')) return 'military';
  if (tags.amenity === 'prison' || tags.landuse === 'prison') return 'prison';
  if (tags.amenity === 'school' || tags.amenity === 'kindergarten') return 'school';
  if (tags.access === 'private' || tags.access === 'no') return 'private';
  return null;
}

/** Barrier nodes that block runners: locked, or tagged private/no for everyone on foot. */
export function isClosedBarrier(tags: Tags): boolean {
  if (!tags.barrier) return false;
  if (tags.locked === 'yes') return true;
  const foot = tags.foot ?? tags.access;
  return foot === 'private' || foot === 'no';
}

const isArea = (w: OsmWay) => !w.tags.highway && w.geometry.length >= 4;

interface Polygon {
  ring: [number, number][];
  box: [number, number, number, number];
}

function inside(x: number, y: number, ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Sets `access` on every climb. Mutates in place. */
export function annotateAccess(climbs: Climb[], ways: OsmWay[]): void {
  if (!climbs.length) return;
  const proj = localProjection(climbs[0].coords[0]);
  const xy = (p: LatLon): [number, number] => [proj.x(p.lon), proj.y(p.lat)];
  const polygon = (w: OsmWay): Polygon => {
    const ring = w.geometry.map(xy);
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return { ring, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  };
  const hits = (poly: Polygon, [x, y]: [number, number]) =>
    x >= poly.box[0] && x <= poly.box[2] && y >= poly.box[1] && y <= poly.box[3] && inside(x, y, poly.ring);

  const restricted = ways
    .filter(isArea)
    .map((w) => ({ kind: restrictionOf(w.tags), poly: polygon(w) }))
    .filter((r): r is { kind: Restriction; poly: Polygon } => r.kind !== null);
  const timedParks = ways
    .filter((w) => isArea(w) && w.tags.opening_hours && w.tags.opening_hours !== '24/7')
    .map((w) => ({ hours: w.tags.opening_hours, poly: polygon(w) }));
  const gates = ways.filter((w) => w.geometry.length === 1 && isClosedBarrier(w.tags)).map((w) => xy(w.geometry[0]));

  for (const c of climbs) {
    const access: Access = {};
    // Every 4th sample (~20 m) is plenty to estimate the share inside an area.
    const pts = c.coords.filter((_, i) => i % 4 === 0).map(xy);
    for (const r of restricted) {
      const share = pts.filter((p) => hits(r.poly, p)).length / pts.length;
      if (share >= RESTRICTED_SHARE) {
        access.restricted = r.kind;
        break;
      }
    }
    const mid = xy(c.coords[Math.floor(c.coords.length / 2)]);
    const park = timedParks.find((p) => hits(p.poly, mid));
    if (park) access.hours = park.hours;
    const line = gates.length ? c.coords.map(xy) : [];
    access.closedGate = gates.some(([gx, gy]) =>
      line.some(([x, y]) => Math.abs(x - gx) <= GATE_DISTANCE && Math.abs(y - gy) <= GATE_DISTANCE),
    );
    c.access = access;
  }
}

/** Whether a climb can be shown at all (never relaxed away, unlike filters). */
export const isAccessible = (c: Climb) => !c.access?.restricted && !c.access?.closedGate;
