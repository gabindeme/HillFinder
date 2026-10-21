/**
 * Favourite hills, saved in this browser (localStorage), with everything
 * needed to show them offline: line, profile, stats and score breakdown.
 */
import { useCallback } from 'react';
import { haversine } from '../core/geo';
import type { RankedClimb } from '../core/scoring';
import { useStored } from './storage';

export interface SavedClimb extends RankedClimb {
  /** Stable identity, see favoriteKey(). */
  key: string;
  savedAt: number;
}

/** Unique id for a saved climb (its bottom and top positions). */
export function favoriteKey(c: Pick<RankedClimb, 'coords'>): string {
  const a = c.coords[0];
  const b = c.coords[c.coords.length - 1];
  return [a.lat, a.lon, b.lat, b.lon].map((v) => v.toFixed(5)).join(',');
}

/** Bottoms and tops this close mean the same hill, metres. */
const SAME_CLIMB = 25;

/**
 * Climb ids depend on how a search happened to number things, so a climb
 * matches a favourite when both its bottom and top are within SAME_CLIMB:
 * the same hill found again later, or with the other data source, is
 * recognised. (Comparing rounded keys would fail near rounding boundaries.)
 */
export function sameClimb(a: Pick<RankedClimb, 'coords'>, b: Pick<RankedClimb, 'coords'>): boolean {
  return (
    haversine(a.coords[0], b.coords[0]) <= SAME_CLIMB &&
    haversine(a.coords[a.coords.length - 1], b.coords[b.coords.length - 1]) <= SAME_CLIMB
  );
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Smaller copy for storage: ~1 m coordinate and 0.1 m elevation precision is plenty. */
function compact(c: RankedClimb, key: string): SavedClimb {
  return {
    ...c,
    id: key,
    key,
    savedAt: Date.now(),
    coords: c.coords.map((p) => ({ lat: round(p.lat, 5), lon: round(p.lon, 5) })),
    profile: { dist: c.profile.dist.map((d) => round(d, 1)), ele: c.profile.ele.map((e) => round(e, 1)) },
  };
}

export function useFavorites() {
  const [favorites, setFavorites] = useStored<SavedClimb[]>('hillfinder.favorites', []);
  const isFavorite = useCallback(
    (c: Pick<RankedClimb, 'coords'>) => favorites.some((f) => sameClimb(f, c)),
    [favorites],
  );
  const toggle = useCallback(
    (c: RankedClimb) => {
      setFavorites((list) =>
        list.some((f) => sameClimb(f, c)) ? list.filter((f) => !sameClimb(f, c)) : [compact(c, favoriteKey(c)), ...list],
      );
    },
    [setFavorites],
  );
  return { favorites, isFavorite, toggle };
}
