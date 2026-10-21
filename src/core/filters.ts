/** User-tunable search filters and their defaults. */

export type Priority = 'balanced' | 'steepest' | 'longest' | 'gain' | 'closest' | 'trail';
export type Surface = 'any' | 'trail' | 'road';
/** How the search area is limited: a straight radius, or travel time to the hill. */
export type Reach = 'distance' | 'foot' | 'bike';

export interface Filters {
  reach: Reach;
  radiusKm: number;
  /** Used when reach is 'foot' or 'bike'. */
  travelMinutes: number;
  minLength: number;
  maxLength: number;
  minGain: number;
  /** Average grade range, percent. */
  minAvgGrade: number;
  maxAvgGrade: number;
  /** Optional cap on the steepest 50 m section, percent. */
  maxGrade: number | null;
  surface: Surface;
  avoidTraffic: boolean;
  preferLit: boolean;
  /** Hide climbs in parks with opening hours. */
  openAllTimes: boolean;
  priority: Priority;
}

export const DEFAULT_FILTERS: Filters = {
  reach: 'distance',
  radiusKm: 5,
  travelMinutes: 15,
  minLength: 80,
  maxLength: 2000,
  minGain: 8,
  minAvgGrade: 3,
  maxAvgGrade: 25,
  maxGrade: null,
  surface: 'any',
  avoidTraffic: true,
  preferLit: false,
  openAllTimes: false,
  priority: 'balanced',
};

export const RADIUS_RANGE = { min: 1, max: 30 } as const;
export const MINUTES_RANGE = { min: 5, max: 60 } as const;

/** Easy running / steady cycling speeds, km/h (the trip to the hill is the warm-up). */
const SPEED_KMH: Record<Exclude<Reach, 'distance'>, number> = { foot: 10, bike: 18 };
/**
 * Streets don't go in straight lines: typical urban routes are ~1.3× the
 * straight-line distance. Dividing by this turns travel distance into a
 * straight-line search radius.
 */
const DETOUR_FACTOR = 1.3;

/** Straight-line search radius implied by the filters, km. */
export function effectiveRadiusKm(f: Filters): number {
  if (f.reach === 'distance') return f.radiusKm;
  const km = (SPEED_KMH[f.reach] * f.travelMinutes) / 60 / DETOUR_FACTOR;
  return Math.min(RADIUS_RANGE.max, Math.max(RADIUS_RANGE.min, Math.round(km * 10) / 10));
}

/** Rough travel time to a point at a straight-line distance, minutes. */
export function travelMinutesTo(distanceM: number, reach: Exclude<Reach, 'distance'>): number {
  return ((distanceM / 1000) * DETOUR_FACTOR * 60) / SPEED_KMH[reach];
}

/** Number of filters differing from the defaults (shown on the "More filters" button). */
export function activeFilterCount(f: Filters): number {
  const keys: (keyof Filters)[] = [
    'minLength', 'maxLength', 'minGain', 'minAvgGrade', 'maxAvgGrade', 'maxGrade', 'surface', 'avoidTraffic', 'preferLit', 'openAllTimes',
  ];
  return keys.filter((k) => f[k] !== DEFAULT_FILTERS[k]).length;
}

/** Below this average safety, a climb counts as being on a busy road. */
export const BUSY_ROAD_SAFETY = 0.4;
