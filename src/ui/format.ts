import i18n, { type TFunction } from 'i18next';
import { travelMinutesTo, type Reach } from '../core/filters';
import type { Climb } from '../core/types';

// Numbers follow the UI language: "7.4%" in English, "7,4 %" in French.
const lang = () => i18n.language || 'en';

/** A number with a fixed count of decimals, in the UI language. */
export const fmtNum = (v: number, digits = 0) =>
  new Intl.NumberFormat(lang(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
export const fmtM = (m: number) => `${fmtNum(m)} m`;
export const fmtGrade = (g: number) =>
  new Intl.NumberFormat(lang(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(g / 100);
export const fmtKm = (m: number) => fmtNum(m / 1000, 1);

export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function climbName(c: Climb, t: TFunction): string {
  if (c.names.length) return c.names.slice(0, 2).join(' → ');
  const kind = t(`climb.kinds.${c.highway}`, { defaultValue: c.highway });
  if (c.near) return t(`climb.${c.near.kind}`, { kind: capitalize(kind), name: c.near.name });
  return capitalize(t('climb.unnamed', { kind }));
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
