/** User-tunable search filters and their defaults. */

export type Priority = 'balanced' | 'steepest' | 'longest' | 'gain' | 'closest' | 'trail';
export type Surface = 'any' | 'trail' | 'road';

export interface Filters {
  radiusKm: number;
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
  priority: Priority;
}

export const DEFAULT_FILTERS: Filters = {
  radiusKm: 5,
  minLength: 80,
  maxLength: 2000,
  minGain: 8,
  minAvgGrade: 3,
  maxAvgGrade: 25,
  maxGrade: null,
  surface: 'any',
  avoidTraffic: true,
  preferLit: false,
  priority: 'balanced',
};

export const RADIUS_RANGE = { min: 1, max: 30 } as const;
