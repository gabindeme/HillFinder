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
  for (const climb of sorted) {
    if (kept.length >= limit) break;
    const pts = climb.coords.map((p) => [proj.x(p.lon), proj.y(p.lat)] as [number, number]);
    const overlapping = pts.filter(([x, y]) => isNear(x, y)).length;
    if (overlapping / pts.length > MAX_OVERLAP) continue;
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
