/**
 * Dev script: does coarse detection + LiDAR re-measurement find the same top
 * hills as fine detection? Usage: pnpm tsx scripts/compare-precision.ts [lat lon km]
 */
import { DEFAULT_FILTERS } from '../src/core/filters';
import { bboxAround } from '../src/core/geo';
import { findCandidates } from '../src/core/pipeline';
import { refineClimb, reliability } from '../src/core/refine';
import { rankClimbs } from '../src/core/scoring';
import type { Climb } from '../src/core/types';
import { fineProfiles } from '../src/data/fineElevation';
import { chooseLevel, loadElevation } from '../src/data/ignElevation';
import { fetchWaysFromTiles } from '../src/data/vectorTiles';

const [lat = 48.1113, lon = -1.68, km = 5] = process.argv.slice(2).map(Number);
const origin = { lat, lon };
const radius = km * 1000;
const filters = { ...DEFAULT_FILTERS, radiusKm: km };
const ways = await fetchWaysFromTiles(bboxAround(origin, radius + 500));
const box = bboxAround(origin, radius + 1000);
const tiles = (lvl: number) => {
  const s = 0.02 * 2 ** lvl, t = 0.03 * 2 ** lvl;
  return (Math.floor(box.north / s) - Math.floor(box.south / s) + 1) * (Math.floor(box.east / t) - Math.floor(box.west / t) + 1);
};
const level = chooseLevel(box);
console.log(`fine grid: level ${level}, ${tiles(level)} MB · coarse grid: level ${level + 1}, ${tiles(level + 1)} MB`);

const fine = findCandidates(ways, (await loadElevation(box)).sampler, origin, radius);
const fineTop = rankClimbs(fine, filters).climbs;

// Coarse detection, then re-measure what's shown until the top 20 is stable.
let coarse: Climb[] = findCandidates(ways, (await loadElevation(box, undefined, undefined, 1)).sampler, origin, radius);
const tried = new Set<string>();
let points = 0;
for (let round = 0; round < 5; round++) {
  const todo = rankClimbs(coarse, filters).climbs.filter((c) => !c.refined && !tried.has(c.id));
  if (!todo.length) break;
  todo.forEach((c) => tried.add(c.id));
  points += todo.reduce((s, c) => s + c.coords.length, 0);
  const res = await fineProfiles(todo.map((c) => c.coords));
  const byId = new Map(todo.map((c, i) => [c.id, res[i] ? refineClimb(c, res[i]!.ele, res[i]!.source) : null]));
  coarse = coarse.flatMap((c) => (byId.has(c.id) ? (byId.get(c.id) ? [byId.get(c.id)!] : []) : [c]));
  console.log(`round ${round + 1}: re-measured ${todo.length} climbs`);
}
const coarseTop = rankClimbs(coarse, filters).climbs;
console.log(`re-measured ${tried.size} climbs, ${points} points\n`);

const near = (a: Climb, b: Climb) =>
  Math.hypot((a.coords[0].lat - b.coords[0].lat) * 111e3, (a.coords[0].lon - b.coords[0].lon) * 74e3) < 60;
const fmt = (c: Climb) =>
  `${c.length.toFixed(0).padStart(4)} m +${c.gain.toFixed(1).padStart(4)} ${c.avgGrade.toFixed(1).padStart(4)}% max ${c.maxGrade.toFixed(1).padStart(4)}%`;
console.log('rank | fine 4 m grid                       | coarse + LiDAR                      | in other top 20?');
for (let i = 0; i < 20; i++) {
  const f = fineTop[i], c = coarseTop[i];
  const rel = c ? reliability(c) : null;
  console.log(
    `${String(i + 1).padStart(4)} | ${f ? fmt(f) : ''.padEnd(35)} | ${c ? fmt(c) : ''.padEnd(35)} | ` +
      `${f && coarseTop.some((x) => near(x, f)) ? 'yes' : 'NO '} / ${c && fineTop.some((x) => near(x, c)) ? 'yes' : 'NO '} ${rel?.level ?? ''} ${rel?.reasons.join(',') ?? ''}`,
  );
}
