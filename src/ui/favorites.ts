/**
 * Favourite hills, saved in this browser (localStorage), with everything
 * needed to show them offline: line, profile, stats and score breakdown.
 */
import { useCallback } from 'react';
import type { RankedClimb } from '../core/scoring';
import { useStored } from './storage';

export interface SavedClimb extends RankedClimb {
  /** Stable identity, see favoriteKey(). */
  key: string;
  savedAt: number;
}

/**
 * Climb ids depend on how a search happened to number things, so favourites
 * are identified by their bottom and top (~10 m precision) instead: the same
 * hill found again later, or with the other data source, is recognised.
 */
export function favoriteKey(c: Pick<RankedClimb, 'coords'>): string {
  const a = c.coords[0];
  const b = c.coords[c.coords.length - 1];
  return [a.lat, a.lon, b.lat, b.lon].map((v) => v.toFixed(4)).join(',');
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
    (c: Pick<RankedClimb, 'coords'>) => favorites.some((f) => f.key === favoriteKey(c)),
    [favorites],
  );
  const toggle = useCallback(
    (c: RankedClimb) => {
      const key = favoriteKey(c);
      setFavorites((list) => (list.some((f) => f.key === key) ? list.filter((f) => f.key !== key) : [compact(c, key), ...list]));
    },
    [setFavorites],
  );
  return { favorites, isFavorite, toggle };
}
