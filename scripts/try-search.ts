/**
 * Dev script: run the full climb search from the command line.
 * Usage: pnpm try [lat] [lon] [radiusKm] [ways.json]
 * Defaults to central Rennes, 5 km.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_FILTERS } from '../src/core/filters';
import { bboxAround } from '../src/core/geo';
import { findCandidates } from '../src/core/pipeline';
import { rankClimbs } from '../src/core/scoring';
import { suggestSession } from '../src/core/session';
import type { OsmWay } from '../src/core/types';
import { loadElevation } from '../src/data/ignElevation';
import { fetchWays } from '../src/data/overpass';

const [lat = 48.1113, lon = -1.68, radiusKm = 5] = process.argv.slice(2, 5).map(Number);
const waysFile = process.argv[5];
const origin = { lat, lon };
const radius = radiusKm * 1000;

console.time('ways');
const ways: OsmWay[] = waysFile
  ? (JSON.parse(readFileSync(waysFile, 'utf8')).elements as OsmWay[]).filter((e) => e.nodes)
  : await fetchWays(origin, radius + 500);
console.timeEnd('ways');
console.log(ways.length, 'ways');

console.time('elevation');
const grid = await loadElevation(bboxAround(origin, radius + 1500));
console.timeEnd('elevation');
console.log(`level ${grid.level}, ~${grid.resolution.toFixed(1)} m/px`);

console.time('detect');
const candidates = findCandidates(ways, grid.sampler, origin, radius);
console.timeEnd('detect');
console.log(candidates.length, 'candidates');

for (const priority of ['balanced', 'steepest'] as const) {
  const { climbs, relaxLevel } = rankClimbs(candidates, { ...DEFAULT_FILTERS, radiusKm, priority });
  console.log(`\n== ${priority} (relax ${relaxLevel}) ==`);
  for (const c of climbs.slice(0, 10)) {
    const s = suggestSession(c);
    console.log(
      `#${c.rank} ${c.score.toFixed(0).padStart(3)}  ${(c.names.join(' / ') || (c.near ? `${c.near.kind} ${c.near.name}` : '(unnamed)')).slice(0, 45).padEnd(45)}` +
        ` ${c.length.toFixed(0).padStart(5)} m  +${c.gain.toFixed(1).padStart(5)} m  avg ${c.avgGrade.toFixed(1)}%` +
        `  max ${c.maxGrade.toFixed(1)}%  ${(c.distance / 1000).toFixed(1)} km  trail ${c.trail.toFixed(2)}` +
        `  → ${s.reps}×${s.repLength} m  @${c.coords[0].lat.toFixed(5)},${c.coords[0].lon.toFixed(5)}`,
    );
  }
}
