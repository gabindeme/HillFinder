/**
 * Removing near-duplicate climbs.
 *
 * The same hill is often found several times: the road and its separately
 * mapped sidewalks, or a long climb and a stroke that shares its middle part.
 * Going down a list sorted best-first, we drop a climb when most of it lies
 * within a few metres of climbs already kept.
 */
import { localProjection } from './geo';
import type { Climb } from './types';

const NEAR = 20; // metres
const MAX_OVERLAP = 0.5;
/**
 * Two climbs whose bottoms and tops are both this close are treated as the
 * same hill climbed by parallel routes (e.g. several park paths up one
 * slope); only the best one is kept so the list shows different hills.
 */
const SAME_HILL = 250; // metres

export function dedupe<T extends Climb>(sorted: T[], limit = Infinity): T[] {
  if (!sorted.length) return [];
  const proj = localProjection(sorted[0].coords[0]);
  // Spatial hash of kept climbs' points, cell size = NEAR.
  const cells = new Map<string, [number, number][]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;

  const isNear = (x: number, y: number) => {
    const cx = Math.floor(x / NEAR);
    const cy = Math.floor(y / NEAR);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [px, py] of cells.get(key(cx + dx, cy + dy)) ?? []) {
          if ((px - x) ** 2 + (py - y) ** 2 <= NEAR * NEAR) return true;
        }
      }
    }
    return false;
  };

  const kept: T[] = [];
  const ends: [number, number, number, number][] = []; // bottom x,y and top x,y of kept climbs
  for (const climb of sorted) {
    if (kept.length >= limit) break;
    const pts = climb.coords.map((p) => [proj.x(p.lon), proj.y(p.lat)] as [number, number]);
    const overlapping = pts.filter(([x, y]) => isNear(x, y)).length;
    if (overlapping / pts.length > MAX_OVERLAP) continue;
    const [bx, by] = pts[0];
    const [tx, ty] = pts[pts.length - 1];
    const sameHill = ends.some(
      ([kbx, kby, ktx, kty]) =>
        Math.hypot(kbx - bx, kby - by) < SAME_HILL && Math.hypot(ktx - tx, kty - ty) < SAME_HILL,
    );
    if (sameHill) continue;
    ends.push([bx, by, tx, ty]);
    kept.push(climb);
    for (const pt of pts) {
      const k = key(Math.floor(pt[0] / NEAR), Math.floor(pt[1] / NEAR));
      const list = cells.get(k);
      if (list) list.push(pt);
      else cells.set(k, [pt]);
    }
  }
  return kept;
}
