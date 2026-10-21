/**
 * Giving unnamed climbs a useful label. Many of the best climbs are park
 * paths or footways with no name in OSM; "Footpath in Parc du Thabor" or
 * "Footpath near Rue Martenot" is far more useful than "Unnamed footpath".
 */
import { localProjection } from './geo';
import type { Climb, OsmWay } from './types';

/** Named areas worth mentioning; fetched alongside the paths (see overpass.ts). */
const AREA_TAGS = ['leisure', 'landuse', 'natural'] as const;
/** How far we look for a named street, metres. */
const STREET_RADIUS = 150;
const CELL = 50;

export function isNamedArea(w: OsmWay): boolean {
  return !!w.tags.name && !w.tags.highway && AREA_TAGS.some((k) => k in w.tags) && w.geometry.length >= 4;
}

/** Ray-casting point-in-polygon on a closed ring, in projected metres. */
function inside(x: number, y: number, ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Sets `near` on climbs that have no name of their own. Mutates in place. */
export function labelUnnamed(climbs: Climb[], ways: OsmWay[]): void {
  const todo = climbs.filter((c) => !c.names.length);
  if (!todo.length) return;
  const proj = localProjection(todo[0].coords[0]);
  const xy = (p: { lat: number; lon: number }): [number, number] => [proj.x(p.lon), proj.y(p.lat)];

  const areas = ways.filter(isNamedArea).map((w) => {
    const ring = w.geometry.map(xy);
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    return { name: w.tags.name, ring, box, area };
  });
  // Smallest first: "Jardin des Plantes" beats the larger district park containing it.
  areas.sort((a, b) => a.area - b.area);

  // Spatial hash of named street vertices.
  const streets = new Map<string, { x: number; y: number; name: string }[]>();
  for (const w of ways) {
    if (!w.tags.highway || !w.tags.name) continue;
    for (const p of w.geometry) {
      const [x, y] = xy(p);
      const k = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      const list = streets.get(k);
      const v = { x, y, name: w.tags.name };
      if (list) list.push(v);
      else streets.set(k, [v]);
    }
  }

  for (const c of todo) {
    const [x, y] = xy(c.coords[Math.floor(c.coords.length / 2)]);
    const area = areas.find(
      (a) => x >= a.box[0] && x <= a.box[2] && y >= a.box[1] && y <= a.box[3] && inside(x, y, a.ring),
    );
    if (area) {
      c.near = { kind: 'in', name: area.name };
      continue;
    }
    let best: { d: number; name: string } | null = null;
    const r = Math.ceil(STREET_RADIUS / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const v of streets.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(v.x - x, v.y - y);
          if (d <= STREET_RADIUS && (!best || d < best.d)) best = { d, name: v.name };
        }
      }
    }
    if (best) c.near = { kind: 'near', name: best.name };
  }
}
