import type { TFunction } from 'i18next';
import { travelMinutesTo, type Reach } from '../core/filters';
import type { Climb } from '../core/types';

export const fmtM = (m: number) => `${Math.round(m)} m`;
export const fmtGrade = (g: number) => `${g.toFixed(1)}%`;
export const fmtKm = (m: number) => (m / 1000).toFixed(1);

export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function climbName(c: Climb, t: TFunction): string {
  if (c.names.length) return c.names.slice(0, 2).join(' → ');
  const kind = t(`climb.kinds.${c.highway}`, { defaultValue: c.highway });
  if (c.near) return t(`climb.${c.near.kind}`, { kind: capitalize(kind), name: c.near.name });
  return t('climb.unnamed', { kind });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function surfaceLabel(c: Climb, t: TFunction): string {
  return c.trail >= 0.65 ? t('climb.trail') : c.trail <= 0.35 ? t('climb.road') : t('climb.mixed');
}

/**
 * Colour for a gradient, used on the map and the profile chart.
 * Bands chosen for running: <3% barely felt, 3–6% steady, 6–9% hard, 9–12% very hard, >12% brutal.
 */
export function gradeColor(grade: number): string {
  if (grade < 3) return '#8bc34a';
  if (grade < 6) return '#fbc02d';
  if (grade < 9) return '#fb8c00';
  if (grade < 12) return '#e53935';
  return '#8e24aa';
}

/** "1.2 km away", or a travel-time estimate when searching by time. */
export function fmtAway(c: Climb, reach: Reach, t: TFunction): string {
  if (reach === 'distance') return t('climb.away', { km: fmtKm(c.distance) });
  const min = Math.max(1, Math.round(travelMinutesTo(c.distance, reach)));
  return t(reach === 'foot' ? 'climb.awayFoot' : 'climb.awayBike', { min });
}
