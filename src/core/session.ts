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
  /**
   * 'short' = hill sprints, 'medium' = repeats on the whole climb,
   * 'section' = repeats on the steepest part of a long climb,
   * 'stairs' = stair repeats.
   */
  kind: 'short' | 'medium' | 'section' | 'stairs';
  /** The rep's start and end, in metres from the bottom of the climb. */
  from: number;
  to: number;
  /** Steps per rep (stairs only): OSM step_count, or estimated from height. */
  steps?: number;
  stepsEstimated?: boolean;
}

export function estimateRepSeconds(length: number, grade: number, flatSpeed = FLAT_SPEED): number {
  const speed = (flatSpeed * minettiCost(0)) / minettiCost(grade);
  return length / speed;
}

/** Rep length range for long climbs, metres. */
const SECTION_MIN = 200;
const SECTION_MAX = 400;
/** Classic hill repeats last about this long at hard effort, seconds. */
const TARGET_REP = 75;
/** Typical step height, to estimate step counts, metres. */
const STEP_HEIGHT = 0.17;
/** Sustainable vertical speed up stairs at hard effort, m/s. */
const STAIRS_VERTICAL_SPEED = 0.5;

/**
 * The steepest stretch of the given length: a sliding window over the
 * profile maximising gain. Returns sample indices [from, to].
 */
export function steepestSection(dist: number[], ele: number[], length: number): [number, number] {
  let best: [number, number] = [0, dist.length - 1];
  let bestGain = -Infinity;
  let j = 0;
  for (let i = 0; i < dist.length; i++) {
    while (j < dist.length - 1 && dist[j] - dist[i] < length) j++;
    if (dist[j] - dist[i] < length) break;
    const gain = ele[j] - ele[i];
    if (gain > bestGain) {
      bestGain = gain;
      best = [i, j];
    }
  }
  return best;
}

type SessionInput = Pick<Climb, 'length' | 'gain' | 'profile'> & Partial<Pick<Climb, 'stairs' | 'steps'>>;

export function suggestSession(climb: SessionInput): Session {
  const { dist, ele } = climb.profile;
  const last = dist.length - 1;

  if ((climb.stairs ?? 0) >= 0.5) {
    // Stair repeats: count in steps; time from vertical speed.
    const steps = climb.steps ?? Math.round(climb.gain / STEP_HEIGHT);
    const repSeconds = Math.max(climb.gain / STAIRS_VERTICAL_SPEED, climb.length / FLAT_SPEED);
    return {
      reps: clampReps(TARGET_WORK / 2 / repSeconds, 6, 15),
      repLength: round5(climb.length),
      repGain: Math.round(climb.gain),
      avgGrade: round1((climb.gain / climb.length) * 100),
      repSeconds,
      kind: 'stairs',
      from: 0,
      to: dist[last],
      steps,
      stepsEstimated: climb.steps === undefined,
    };
  }

  // Long climbs: repeat their steepest part, sized for a ~75 s effort.
  let [a, b] = [0, last];
  if (climb.length > SECTION_MAX) {
    const grade = climb.gain / climb.length;
    const target = (TARGET_REP * (FLAT_SPEED * minettiCost(0))) / minettiCost(grade);
    const length = Math.min(SECTION_MAX, Math.max(SECTION_MIN, target));
    [a, b] = steepestSection(dist, ele, length);
  }
  const repLength = dist[b] - dist[a];
  const repGain = ele[b] - ele[a];
  const grade = repGain / repLength;
  const repSeconds = estimateRepSeconds(repLength, grade);

  const kind = b - a < last ? 'section' : repSeconds < 45 ? 'short' : 'medium';
  // Short sprints: fewer total seconds of work, but more reps.
  const target = kind === 'short' ? TARGET_WORK / 2 : TARGET_WORK;

  return {
    reps: clampReps(target / repSeconds, 4, kind === 'short' ? 12 : 10),
    repLength: round5(repLength),
    repGain: Math.round(repGain),
    avgGrade: round1(grade * 100),
    repSeconds,
    kind,
    from: dist[a],
    to: dist[b],
  };
}

const clampReps = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));
const round5 = (m: number) => Math.round(m / 5) * 5;
const round1 = (v: number) => Math.round(v * 10) / 10;
