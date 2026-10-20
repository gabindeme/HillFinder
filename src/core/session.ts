/**
 * Suggesting a hill-repeat session for a climb.
 *
 * Rep time is estimated from Minetti et al. (2002), "Energy cost of walking
 * and running at extreme uphill and downhill slopes": cost of running per kg
 * per metre as a polynomial of the gradient. At constant metabolic power,
 * uphill speed ≈ flat speed × C(0) / C(grade). It's a model, so durations are
 * shown as approximations.
 */
import type { Climb } from './types';

/** Energy cost of running, J/(kg·m), for gradient i as a fraction. */
export function minettiCost(i: number): number {
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Hard-effort flat speed used for estimates (≈ 4:30 /km), m/s. */
const FLAT_SPEED = 3.7;
/** Target total uphill effort per session, seconds (~15 min). */
const TARGET_WORK = 15 * 60;

export interface Session {
  reps: number;
  repLength: number;
  repGain: number;
  avgGrade: number;
  /** Estimated duration of one rep, seconds. */
  repSeconds: number;
  /** "short" = hill sprints, "medium" = classic repeats, "long" = long reps on part of the climb. */
  kind: 'short' | 'medium' | 'long';
}

export function estimateRepSeconds(length: number, grade: number, flatSpeed = FLAT_SPEED): number {
  const speed = (flatSpeed * minettiCost(0)) / minettiCost(grade);
  return length / speed;
}

const MAX_REP = 600;

export function suggestSession(climb: Pick<Climb, 'length' | 'gain' | 'profile'>): Session {
  // Long climbs: repeat the first ~600 m rather than the whole thing, using
  // the real profile for that section's gain.
  const { dist, ele } = climb.profile;
  let end = dist.length - 1;
  if (climb.length > MAX_REP) end = dist.findIndex((d) => d >= MAX_REP);
  const repLength = dist[end];
  const repGain = ele[end] - ele[0];
  const grade = repGain / repLength;
  const repSeconds = estimateRepSeconds(repLength, grade);

  const kind = repSeconds < 45 ? 'short' : climb.length > repLength ? 'long' : 'medium';
  // Short sprints: fewer total seconds of work, but more reps.
  const target = kind === 'short' ? TARGET_WORK / 2 : TARGET_WORK;
  const reps = Math.max(4, Math.min(kind === 'short' ? 12 : 10, Math.round(target / repSeconds)));

  return {
    reps,
    repLength: Math.round(repLength / 10) * 10,
    repGain: Math.round(repGain),
    avgGrade: Math.round(grade * 1000) / 10,
    repSeconds,
    kind,
  };
}
