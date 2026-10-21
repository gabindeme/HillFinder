import type { SearchProgress as Progress } from '../data/searchClient';

/**
 * Turns worker progress into overall completion, 0–100, for one search.
 * Stages: quick nearby pass (0–30), full download (30–90, or 0–90 without a
 * nearby pass), analysis (90–100). Never goes backwards, e.g. when tile
 * totals grow as downloads start.
 */
export function progressTracker() {
  let hadNearby = false;
  let best = 0;
  return (p: Progress): number => {
    const f = p.total ? p.done / p.total : 0;
    if (p.stage === 'nearby') hadNearby = true;
    const pct =
      p.stage === 'nearby' ? 30 * f : p.stage === 'download' ? (hadNearby ? 30 + 60 * f : 90 * f) : 90 + 10 * f;
    best = Math.max(best, pct);
    return best;
  };
}
